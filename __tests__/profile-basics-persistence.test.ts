// Profile Basics persistence — production QA defect, 2026-09-23.
//
// A Google-sign-in account with no `profiles` row typed its Basics, saw
// "Saved ✓", and found every field blank after reload. The email could never
// be persisted, so Basics never completed, Next stayed disabled, and
// generation was unreachable despite an active paid entitlement.
//
// Root cause: only /onboarding ever created a profiles row, and the profile
// page's autosave was an UPDATE ... WHERE user_id = ?. Against a missing row
// that matches nothing, and PostgREST reports a zero-row UPDATE as success.
//
// The fake below models exactly that PostgREST behaviour, so the first test
// reproduces the defect with the old query shape and the rest prove the fix
// through a full load → edit → save → reload cycle.
import * as fs from "fs";
import * as path from "path";
import {
  initialBasics,
  buildProfileWrite,
  saveProfile,
  isBasicsComplete,
  isValidEmail,
  type BasicInfo,
  type ProfilesWriter,
  type ProfileBasicsRow,
} from "@/lib/profile-basics";

type Row = Record<string, unknown> & { user_id: string };

/** In-memory `profiles` table with PostgREST's success semantics. */
function fakeDb(initial: Row[] = []) {
  const rows = new Map<string, Row>(initial.map((r) => [r.user_id, { ...r }]));
  const calls: string[] = [];
  let failWith: string | null = null;
  let swallowWrites = false;

  const client = {
    from(table: "profiles") {
      if (table !== "profiles") throw new Error("unexpected table " + table);
      return {
        // Old save path: UPDATE ... WHERE user_id = ?
        update(patch: Record<string, unknown>) {
          return {
            async eq(_col: "user_id", id: string) {
              calls.push("update");
              const existing = rows.get(id);
              if (existing) rows.set(id, { ...existing, ...patch });
              // Zero rows matched is NOT an error in PostgREST.
              return { data: null, error: null };
            },
          };
        },
        // New save path: INSERT ... ON CONFLICT (user_id) DO UPDATE, RETURNING
        upsert(row: Row, opts: { onConflict: string }) {
          return {
            async select() {
              calls.push(`upsert:${opts.onConflict}`);
              if (failWith) return { data: null, error: { message: failWith } };
              if (swallowWrites) return { data: [], error: null };
              const existing = rows.get(row.user_id);
              // Upsert only sets the columns it is given.
              rows.set(row.user_id, { ...(existing ?? {}), ...row });
              return { data: [{ user_id: row.user_id }], error: null };
            },
          };
        },
      };
    },
  };

  return {
    client,
    rows,
    calls,
    failNextWith(msg: string) { failWith = msg; },
    swallowWrites() { swallowWrites = true; },
    /** What the page reads on load: select * ... maybeSingle() */
    load(userId: string) { return (rows.get(userId) ?? null) as (Row & ProfileBasicsRow) | null; },
  };
}

const USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

// Shape of a Supabase auth user after Google OAuth (only the fields used).
const googleUser = {
  email: "qa.google.user@gmail.com",
  user_metadata: { full_name: "QA Google User", name: "QA Google User", email_verified: true },
};

const typed: BasicInfo = {
  full_name: "Asha Synthetic",
  email: "asha.synthetic+qa@example.com",
  phone: "+91 98765 43210",
  current_city: "Kochi",
  graduation_year: "2021",
};

const PROFILE_DATA = { summary: "", experience: [], skills: [], education: [], projects: [] };

describe("reproduction — the old UPDATE-only save", () => {
  it("reported success but wrote nothing for a user with no profile row", async () => {
    const db = fakeDb(); // Google user who skipped /onboarding: no row
    const { error } = await db.client
      .from("profiles")
      .update({ full_name: typed.full_name, email: typed.email })
      .eq("user_id", USER);

    expect(error).toBeNull(); // → the page showed "Saved ✓"
    expect(db.load(USER)).toBeNull(); // → blank after reload
    expect(isBasicsComplete(initialBasics(db.load(USER), null))).toBe(false); // → Next disabled
  });
});

describe("saveProfile — creates the row when it is missing", () => {
  it("persists every Basics field, including email, across a reload", async () => {
    const db = fakeDb();
    const res = await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, typed, [], PROFILE_DATA));
    expect(res).toEqual({ ok: true });

    const reloaded = initialBasics(db.load(USER), googleUser);
    expect(reloaded).toEqual(typed);
    expect(isBasicsComplete(reloaded)).toBe(true);
  });

  it("writes via upsert keyed on user_id", async () => {
    const db = fakeDb();
    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, typed, [], PROFILE_DATA));
    expect(db.calls).toEqual(["upsert:user_id"]);
  });

  it("stores graduation_year as an integer and blank optionals as null", async () => {
    const db = fakeDb();
    const minimal = { ...typed, phone: "", current_city: "  ", graduation_year: "" };
    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, minimal, [], PROFILE_DATA));
    const row = db.load(USER)!;
    expect(row.phone).toBeNull();
    expect(row.current_city).toBeNull();
    expect(row.graduation_year).toBeNull();

    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, typed, [], PROFILE_DATA));
    expect(db.load(USER)!.graduation_year).toBe(2021);
  });
});

describe("saveProfile — updates an existing row without clobbering other columns", () => {
  it("keeps onboarding, free-review, and LinkedIn columns it does not own", async () => {
    const db = fakeDb([
      {
        user_id: USER,
        full_name: "Old Name",
        email: "old@example.com",
        onboarded_at: "2026-09-01T00:00:00Z",
        free_review_used_at: "2026-09-02T00:00:00Z",
        linkedin_data: { headline: "kept" },
      },
    ]);
    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, typed, ["Data Analyst"], PROFILE_DATA));
    const row = db.load(USER)!;
    expect(row.full_name).toBe(typed.full_name);
    expect(row.email).toBe(typed.email);
    expect(row.target_roles).toEqual(["Data Analyst"]);
    expect(row.onboarded_at).toBe("2026-09-01T00:00:00Z");
    expect(row.free_review_used_at).toBe("2026-09-02T00:00:00Z");
    expect(row.linkedin_data).toEqual({ headline: "kept" });
  });
});

describe("saveProfile — never reports a save that did not happen", () => {
  it("fails when the database returns an error", async () => {
    const db = fakeDb();
    db.failNextWith("new row violates row-level security policy");
    const res = await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, typed, [], PROFILE_DATA));
    expect(res).toEqual({ ok: false, message: "new row violates row-level security policy" });
  });

  it("fails when the write is error-free but returns no row", async () => {
    const db = fakeDb();
    db.swallowWrites();
    const res = await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, typed, [], PROFILE_DATA));
    expect(res.ok).toBe(false);
  });
});

describe("initialBasics — Google-account profile initialisation", () => {
  it("prefills name and email from the Google account when there is no profile row", () => {
    const b = initialBasics(null, googleUser);
    expect(b.full_name).toBe("QA Google User");
    expect(b.email).toBe("qa.google.user@gmail.com");
    expect(b.phone).toBe("");
    expect(b.current_city).toBe("");
    expect(b.graduation_year).toBe("");
    expect(isBasicsComplete(b)).toBe(true);
  });

  it("falls back to user_metadata.name when full_name is absent", () => {
    const b = initialBasics(null, { email: "x@gmail.com", user_metadata: { name: "Only Name" } });
    expect(b.full_name).toBe("Only Name");
  });

  it("stored values win over the Google account", () => {
    const b = initialBasics({ full_name: "Stored Name", email: "stored@example.com" }, googleUser);
    expect(b.full_name).toBe("Stored Name");
    expect(b.email).toBe("stored@example.com");
  });

  it("fills a blank stored name or email from the Google account", () => {
    const b = initialBasics({ full_name: "  ", email: null }, googleUser);
    expect(b.full_name).toBe("QA Google User");
    expect(b.email).toBe("qa.google.user@gmail.com");
  });

  it("leaves fields blank when neither the row nor the account has them", () => {
    const b = initialBasics(null, { email: null, user_metadata: {} });
    expect(b).toEqual({ full_name: "", email: "", phone: "", current_city: "", graduation_year: "" });
  });

  it("ignores non-string metadata", () => {
    const b = initialBasics(null, { email: "x@gmail.com", user_metadata: { full_name: 42, name: null } });
    expect(b.full_name).toBe("");
  });

  it("converts a numeric graduation year and drops a bare +91 placeholder", () => {
    const b = initialBasics({ graduation_year: 2021, phone: "+91 " }, null);
    expect(b.graduation_year).toBe("2021");
    expect(b.phone).toBe("");
  });

  it("a prefilled Google user is persisted by the first autosave", async () => {
    const db = fakeDb();
    const b = initialBasics(db.load(USER), googleUser);
    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, b, [], PROFILE_DATA));
    expect(initialBasics(db.load(USER), null)).toMatchObject({
      full_name: "QA Google User",
      email: "qa.google.user@gmail.com",
    });
  });
});

describe("email persistence", () => {
  it.each([
    "vineeth.qa@gmail.com",
    "asha.synthetic+qa@example.com",
    "First.Last@Sub.Example.co.in",
    "a1@b2.io",
    "o'brien@example.ie",
    "user_name-1@example-domain.com",
  ])("%s is valid and survives save → reload unchanged", async (email) => {
    expect(isValidEmail(email)).toBe(true);
    const db = fakeDb();
    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, { ...typed, email }, [], PROFILE_DATA));
    const reloaded = initialBasics(db.load(USER), null);
    expect(reloaded.email).toBe(email);
    expect(isBasicsComplete(reloaded)).toBe(true);
  });

  it("stores a pasted address without its surrounding whitespace", async () => {
    const db = fakeDb();
    await saveProfile(db.client as ProfilesWriter, buildProfileWrite(USER, { ...typed, email: "  a@b.co \n" }, [], PROFILE_DATA));
    expect(db.load(USER)!.email).toBe("a@b.co");
  });
});

describe("isBasicsComplete — gates Next on the Basics step", () => {
  it("requires a name", () => expect(isBasicsComplete({ ...typed, full_name: " " })).toBe(false));
  it("requires a valid email", () => expect(isBasicsComplete({ ...typed, email: "asha@" })).toBe(false));
  it("rejects a malformed optional phone", () => expect(isBasicsComplete({ ...typed, phone: "abc" })).toBe(false));
  it("rejects a malformed optional year", () => expect(isBasicsComplete({ ...typed, graduation_year: "21" })).toBe(false));
  it("accepts name + email alone", () =>
    expect(isBasicsComplete({ full_name: "A", email: "a@b.co", phone: "", current_city: "", graduation_year: "" })).toBe(true));
});

// The page has no DOM test harness in this repo, so pin the wiring that the
// defect lived in. These fail if someone reintroduces the update-only save
// or the error-conflating .single() load.
describe("profile page wiring", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "(app)", "profile", "page.tsx"), "utf8");

  it("does not save Basics with an update-only query", () => {
    expect(src).not.toMatch(/from\("profiles"\)\s*\.update\(/);
  });

  it("saves through saveProfile/buildProfileWrite", () => {
    expect(src).toMatch(/saveProfile\(\s*supabase,\s*buildProfileWrite\(/);
  });

  it("loads with maybeSingle and seeds Basics from the auth user", () => {
    expect(src).toMatch(/from\("profiles"\)\.select\("\*"\)\.eq\("user_id", user\.id\)\.maybeSingle\(\)/);
    expect(src).toMatch(/initialBasics\(profileRes\.data, user\)/);
  });

  it("does not autosave after a failed load", () => {
    expect(src).toMatch(/if \(!loaded \|\| loadError\) return;/);
  });
});
