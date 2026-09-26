/**
 * Release UX fixes (2026-09-26):
 *   1. Role picker "Other" never becomes a target role; a typed role is required.
 *   2. One click, one generation: a double click cannot create two resumes.
 *   3. Dashboard View / Download are real, always-visible controls.
 *   4. Backspace in an empty chip input removes the last chip, safely.
 *   5. JD length feedback states the 200-character rule; "paste" only when empty.
 *   6. The graduation-year error states the range actually enforced.
 *
 * The pages are client components and this suite runs in node, so behaviour
 * lives in small lib modules tested here; the page wiring is checked against
 * the source, as the other page tests in this folder do.
 */
import * as fs from "fs";
import * as path from "path";
import { cleanTargetRoles, customRoleError, isOtherSentinel, MAX_TARGET_ROLES } from "@/lib/target-roles";
import { singleFlight } from "@/lib/single-flight";
import { shouldRemoveLastChip, withoutLastChip } from "@/lib/chip-input";
import { jdLengthStatus, JD_MIN_CHARS } from "@/lib/jd-length";
import { buildProfileWrite, gradYearError, gradYearMax, isValidGradYear, GRAD_YEAR_MIN } from "@/lib/profile-basics";
import { INDIAN_JOB_ROLES } from "@/lib/seed/roles";

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const PROFILE_PAGE = read("app", "(app)", "profile", "page.tsx");
const CREATE_PAGE = read("app", "(app)", "create", "page.tsx");
const DASHBOARD_PAGE = read("app", "(app)", "dashboard", "page.tsx");
const ONBOARDING_PAGE = read("app", "(app)", "onboarding", "page.tsx");
const STEPPER = read("components", "nav", "GlobalStepper.tsx");
const ROUTE = read("app", "api", "generate-resume", "route.ts");

const BASICS = { full_name: "Asha Rao", email: "asha@example.com", phone: "", current_city: "", graduation_year: "" };

// ── 1. "Other" ────────────────────────────────────────────────────────────
describe("1. role picker 'Other'", () => {
  it("the picker still offers Other, and it is recognised as the sentinel in any case/spacing", () => {
    expect(INDIAN_JOB_ROLES).toContain("Other");
    for (const v of ["Other", "other", "  OTHER  "]) expect(isOtherSentinel(v)).toBe(true);
    expect(isOtherSentinel("Other Ranks Officer")).toBe(false);
  });

  it("cleanTargetRoles drops Other, blanks and duplicates, keeps order, caps at 3", () => {
    expect(cleanTargetRoles(["Other"])).toEqual([]);
    expect(cleanTargetRoles([" Data Analyst ", "other", "", "data analyst", "Supply  Chain Analyst", "Tech Lead", "Teacher"]))
      .toEqual(["Data Analyst", "Supply Chain Analyst", "Tech Lead"]);
    expect(cleanTargetRoles(null)).toEqual([]);
    expect(cleanTargetRoles(["Nurse", 42, null])).toEqual(["Nurse"]);
  });

  it("a typed role must be real: not blank, not 'Other', has a letter, short, new, within the limit", () => {
    expect(customRoleError("   ")).toMatch(/Type the role/);
    expect(customRoleError("Other")).toMatch(/not "Other"/);
    expect(customRoleError("1234")).toMatch(/letter/);
    expect(customRoleError("x".repeat(61))).toMatch(/under 60/);
    expect(customRoleError("data analyst", ["Data Analyst"])).toMatch(/already added/);
    expect(customRoleError("Nurse", ["A", "B", "C"])).toMatch(new RegExp(`up to ${MAX_TARGET_ROLES}`));
    expect(customRoleError("Supply Chain Analyst", ["Data Analyst"])).toBeNull();
    expect(customRoleError("Ingénieure Logiciel")).toBeNull();
  });

  it("the profile write never persists the literal Other", () => {
    expect(buildProfileWrite("u1", BASICS, ["Other"], {}).target_roles).toEqual([]);
    expect(buildProfileWrite("u1", BASICS, ["Other", "Data Analyst"], {}).target_roles).toEqual(["Data Analyst"]);
  });

  it("profile page: Other opens a text field instead of being added; Roles is done only with a real role", () => {
    const toggle = PROFILE_PAGE.slice(PROFILE_PAGE.indexOf("function toggleRole"), PROFILE_PAGE.indexOf("function addCustomRole"));
    expect(toggle.indexOf("isOtherSentinel(role)")).toBeGreaterThan(-1);
    expect(toggle.indexOf("isOtherSentinel(role)")).toBeLessThan(toggle.indexOf("setTargetRoles"));
    expect(PROFILE_PAGE).toMatch(/const sec2Done = cleanTargetRoles\(targetRoles\)\.length > 0;/);
    expect(PROFILE_PAGE).toMatch(/setTargetRoles\(cleanTargetRoles\(p\.target_roles\)\)/);
    expect(PROFILE_PAGE).toMatch(/customRoleError\(otherDraft, targetRoles\)/);
    // A typed-but-not-added role blocks Next rather than being silently lost.
    expect(PROFILE_PAGE).toMatch(/currentStep === 4 && otherOpen && otherDraft\.trim\(\)/);
  });

  it("create page, stepper and generate route all read roles through cleanTargetRoles", () => {
    expect(CREATE_PAGE).toMatch(/if \(!cleanTargetRoles\(profile\.target_roles\)\.length\) return \{ complete: false/);
    expect(CREATE_PAGE).toMatch(/target_roles: cleanTargetRoles\(profile!\.target_roles\)/);
    expect(CREATE_PAGE).not.toMatch(/profile!?\.target_roles!?\.(slice|join)/);
    expect(STEPPER).toMatch(/roles: cleanTargetRoles\(p\?\.target_roles\)\.length > 0/);
    expect(ROUTE).toMatch(/target_roles: z\.array\(z\.string\(\)\)\.optional\(\)\.transform\(.*cleanTargetRoles\(r\)/);
  });
});

// ── 2. Double submit ──────────────────────────────────────────────────────
describe("2. one click, one generation", () => {
  const deferred = () => {
    let resolve!: (v: string) => void, reject!: (e: Error) => void;
    const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it("concurrent calls share one run and one result", async () => {
    const d = deferred();
    const fn = jest.fn(() => d.promise);
    const run = singleFlight(fn);
    const a = run(), b = run(), c = run();
    expect(run.inFlight).toBe(true);
    d.resolve("resume-1");
    await expect(Promise.all([a, b, c])).resolves.toEqual(["resume-1", "resume-1", "resume-1"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(run.inFlight).toBe(false);
  });

  it("a deliberate later generation still runs (repeat generation is not blocked)", async () => {
    let n = 0;
    const fn = jest.fn(async () => `resume-${++n}`);
    const run = singleFlight(fn);
    await expect(run()).resolves.toBe("resume-1");
    await expect(run()).resolves.toBe("resume-2");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a failure releases the lock so the user can retry", async () => {
    const d = deferred();
    const fn = jest.fn().mockReturnValueOnce(d.promise).mockResolvedValueOnce("resume-2");
    const run = singleFlight(fn);
    const a = run(), b = run();
    d.reject(new Error("network"));
    await expect(a).rejects.toThrow("network");
    await expect(b).rejects.toThrow("network");
    expect(run.inFlight).toBe(false);
    await expect(run()).resolves.toBe("resume-2");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("the page's flow: a double click makes one API call and one INSERT; a later click makes another", async () => {
    // Mirrors create/page.tsx: handleClickGenerate -> generateFlight(() => handleGenerate()),
    // where handleGenerate calls the API (spends a credit) then INSERTs the row.
    const api = jest.fn(async () => ({ resume_json: { ats_score: 70 } }));
    const inserts: unknown[] = [];
    const handleGenerate = async () => { const data = await api(); inserts.push(data.resume_json); };
    const generateFlight = singleFlight((run: () => Promise<void>) => run());
    const handleClickGenerate = async () => {
      if (generateFlight.inFlight) return;
      await generateFlight(() => handleGenerate());
    };
    await Promise.all([handleClickGenerate(), handleClickGenerate()]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    await handleClickGenerate();
    expect(api).toHaveBeenCalledTimes(2);
    expect(inserts).toHaveLength(2);
  });

  it("create page wires Generate through the synchronous lock", () => {
    expect(CREATE_PAGE).toMatch(/const generateFlight = useRef\(singleFlight\(/);
    const click = CREATE_PAGE.slice(CREATE_PAGE.indexOf("async function handleClickGenerate"), CREATE_PAGE.indexOf("const completeness = checkCompleteness(profile);\n  const isCreator"));
    expect(click).toMatch(/^async function handleClickGenerate\(\) \{\s+\/\/[^\n]*\n\s+if \(generateFlight\.current\.inFlight\) return;/);
    expect(click).toMatch(/await generateFlight\.current\(\(\) => handleGenerate\(\)\);/);
    // handleGenerate is reachable only through the lock.
    expect(CREATE_PAGE.match(/(?<!function )handleGenerate\(\)/g)).toEqual(["handleGenerate()"]);
  });
});

// ── 3. Dashboard actions ──────────────────────────────────────────────────
describe("3. dashboard View / Download on touch and keyboard", () => {
  const card = DASHBOARD_PAGE.slice(DASHBOARD_PAGE.indexOf("resumes.map((resume)"), DASHBOARD_PAGE.indexOf("<Dialog open"));

  it("actions are never hidden until hover", () => {
    expect(card).not.toMatch(/opacity-0/);
    expect(card).not.toMatch(/group-hover:opacity/);
  });

  it("actions are not nested inside the card link; the title link is stretched over the card", () => {
    // The card root is a div; the only card-wide link is the stretched title.
    expect(card).toMatch(/<div\s+key=\{resume\.id\}/);
    expect(card).toMatch(/after:absolute after:inset-0/);
    expect(card).toMatch(/className="relative z-10 flex gap-2"/);
    expect(DASHBOARD_PAGE).not.toMatch(/handleViewResume/);
  });

  it("View is a real link; Download and Delete are labelled buttons with touch-sized targets", () => {
    expect(card).toMatch(/<Button asChild[^>]*>\s*<Link href=\{`\/preview\/\$\{resume\.id\}`\} aria-label=\{`View /);
    expect(card).toMatch(/aria-label=\{`Download \$\{resume\.tailored_role \|\| "resume"\} as PDF`\}/);
    expect(card).toMatch(/aria-label=\{`Delete /);
    expect(card.match(/\[@media\(pointer:coarse\)\]:h-11/g)?.length).toBe(3);
  });
});

// ── 4. Chip Backspace ─────────────────────────────────────────────────────
describe("4. Backspace in an empty chip input", () => {
  it("removes the last chip only in the safe case", () => {
    expect(shouldRemoveLastChip({ key: "Backspace" }, "", 3)).toBe(true);
    expect(shouldRemoveLastChip({ key: "Backspace" }, "Rea", 3)).toBe(false);   // editing text
    expect(shouldRemoveLastChip({ key: "Backspace" }, " ", 3)).toBe(false);     // not empty
    expect(shouldRemoveLastChip({ key: "Backspace" }, "", 0)).toBe(false);      // nothing to remove
    expect(shouldRemoveLastChip({ key: "Backspace", repeat: true }, "", 3)).toBe(false); // held key
    expect(shouldRemoveLastChip({ key: "Backspace", isComposing: true }, "", 3)).toBe(false); // IME
    expect(shouldRemoveLastChip({ key: "Backspace", ctrlKey: true }, "", 3)).toBe(false);
    expect(shouldRemoveLastChip({ key: "Backspace", metaKey: true }, "", 3)).toBe(false);
    expect(shouldRemoveLastChip({ key: "Delete" }, "", 3)).toBe(false);
  });

  it("removes exactly the last chip without mutating the list", () => {
    const skills = ["React", "SQL", "Power BI"];
    expect(withoutLastChip(skills)).toEqual(["React", "SQL"]);
    expect(skills).toEqual(["React", "SQL", "Power BI"]);
    expect(withoutLastChip([])).toEqual([]);
  });

  it("both chip inputs use it (profile Skills, create '+ add skill')", () => {
    expect(PROFILE_PAGE).toMatch(/shouldRemoveLastChip\(\{[^}]*\}, skillInput, skills\.length\)/);
    expect(PROFILE_PAGE).toMatch(/setSkills\(\(prev\) => withoutLastChip\(prev\)\)/);
    expect(CREATE_PAGE).toMatch(/shouldRemoveLastChip\(\{[^}]*\}, newSkillInput, visible\.length\)/);
  });
});

// ── 5. JD length feedback ─────────────────────────────────────────────────
describe("5. JD length feedback", () => {
  it("empty (or whitespace only): the paste prompt", () => {
    for (const t of ["", "   \n  "]) {
      const s = jdLengthStatus(t);
      expect(s.state).toBe("empty");
      expect(s.ready).toBe(false);
      expect(s.blocker).toBe("Paste a job description to continue");
      expect(s.toast).toMatch(/^Paste/);
    }
  });

  it.each([1, 57, 199])("%i characters: states the 200-character requirement, never 'paste'", (n) => {
    const s = jdLengthStatus("x".repeat(n));
    expect(s.state).toBe("short");
    expect(s.ready).toBe(false);
    for (const msg of [s.blocker, s.toast, s.counter]) {
      expect(msg).toMatch(new RegExp(`${JD_MIN_CHARS}`));
      expect(msg).not.toMatch(/paste/i);
    }
    expect(s.blocker).toContain(`${n} so far, ${JD_MIN_CHARS - n} more to go`);
  });

  it("readiness counts trimmed text, and the counter agrees with it", () => {
    expect(jdLengthStatus(`  ${"x".repeat(199)}   `).ready).toBe(false);
    const ok = jdLengthStatus(`  ${"x".repeat(200)}  `);
    expect(ok).toMatchObject({ ready: true, state: "ok", count: 200, counter: "200 characters ✓", blocker: null, toast: null });
  });

  it("create page shows these messages instead of the unconditional paste prompt", () => {
    expect(CREATE_PAGE).not.toMatch(/Paste a job description above to continue/);
    expect(CREATE_PAGE).not.toMatch(/jdText\.length < 200/);
    expect(CREATE_PAGE).toMatch(/\{jdStatus\.counter\}/);
    expect(CREATE_PAGE.match(/\{jdStatus\.blocker\}/g)).toHaveLength(2);
    expect(CREATE_PAGE).toMatch(/toast\.error\(jdStatus\.toast\)/);
  });
});

// ── 6. Graduation year ────────────────────────────────────────────────────
describe("6. graduation year error states the permitted range", () => {
  const NOW = new Date("2026-09-26T12:00:00Z");

  it("the message names the exact range the check enforces", () => {
    expect(GRAD_YEAR_MIN).toBe(1950);
    expect(gradYearMax(NOW)).toBe(2036);
    for (const bad of ["1949", "2037", "22", "20222", "abcd"]) {
      expect(isValidGradYear(bad, NOW)).toBe(false);
      expect(gradYearError(bad, NOW)).toBe("Enter a 4-digit year from 1950 to 2036.");
    }
    for (const ok of ["", "1950", "2022", "2036"]) expect(gradYearError(ok, NOW)).toBeNull();
  });

  it("the range moves with the clock", () => {
    expect(gradYearError("2040", new Date("2031-01-01T00:00:00Z"))).toBeNull();
    expect(gradYearError("2042", new Date("2031-01-01T00:00:00Z"))).toBe("Enter a 4-digit year from 1950 to 2041.");
  });

  it("profile and onboarding both show it (onboarding previously saved any string via parseInt)", () => {
    expect(PROFILE_PAGE).toMatch(/error=\{gradYearError\(basics\.graduation_year\)\}/);
    expect(PROFILE_PAGE).not.toMatch(/Enter a 4-digit year, e\.g\. 2022/);
    expect(ONBOARDING_PAGE).toMatch(/const error = gradYearError\(value \?\? ""\);/);
    expect(ONBOARDING_PAGE).toMatch(/\{errors\.graduation_year && <p[^>]*>\{errors\.graduation_year\.message\}<\/p>\}/);
  });
});
