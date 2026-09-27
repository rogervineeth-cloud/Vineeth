/**
 * Live QA: a second tab opened on /create?step=review showed the same JD but
 * Basics and Roles incomplete and Generate disabled, while the first tab
 * showed the complete profile. Both the create page and the stepper loaded
 * the profile once and treated ANY failure — a rejected getUser (auth-js
 * rejects the call whose cross-tab session lock was stolen), a transient auth
 * error, a failed profiles query — as "no profile".
 *
 * lib/profile-hydration.ts retries, and reports a failure as a failure, never
 * as a missing profile. Jest has no DOM here, so the page and stepper wiring
 * is checked by reading their source.
 */
import * as fs from "fs";
import * as path from "path";
import { loadSignedInProfile, withRetry, type ProfileClient } from "@/lib/profile-hydration";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "aarav@example.com" };
const PROFILE = { full_name: "Aarav Menon", email: "aarav@example.com", target_roles: ["Data Analyst"], profile_data: {} };

type Step<T> = T | Error;
/** A fake client whose getUser / profile query answer from a script, one entry per call. */
function client(auth: Step<{ data: { user: typeof USER | null }; error: { name?: string; message?: string } | null }>[],
                rows: Step<{ data: unknown; error: { message: string } | null }>[] = [{ data: PROFILE, error: null }]) {
  const calls = { getUser: 0, profile: 0, filters: [] as [string, string][], columns: [] as string[] };
  const next = <T>(list: Step<T>[], i: number): Promise<T> => {
    const s = list[Math.min(i, list.length - 1)];
    return s instanceof Error ? Promise.reject(s) : Promise.resolve(s);
  };
  const c: ProfileClient = {
    auth: { getUser: () => next(auth, calls.getUser++) },
    from: () => ({
      select: (columns: string) => {
        calls.columns.push(columns);
        return { eq: (col: string, val: string) => { calls.filters.push([col, val]); return { maybeSingle: () => next(rows, calls.profile++) }; } };
      },
    }),
  };
  return { c, calls };
}
const ok = { data: { user: USER }, error: null };
const noWait = { wait: async () => {} };

describe("loadSignedInProfile", () => {
  it("loads the signed-in user's own profile", async () => {
    const { c, calls } = client([ok]);
    await expect(loadSignedInProfile(c, "*", noWait)).resolves.toEqual({ status: "ready", user: USER, profile: PROFILE });
    expect(calls.filters).toEqual([["user_id", USER.id]]);
  });

  it("fresh-tab case: getUser rejects because another request stole the session lock, then succeeds → profile loaded", async () => {
    const stolen = Object.assign(new Error('Lock "lock:sb-x-auth-token" was released because another request stole it'), { name: "NavigatorLockAcquireTimeoutError" });
    const { c, calls } = client([stolen, ok]);
    const res = await loadSignedInProfile(c, "*", noWait);
    expect(res).toEqual({ status: "ready", user: USER, profile: PROFILE });
    expect(calls.getUser).toBe(2);
  });

  it("a transient auth error (no user, not a signed-out answer) is retried, not treated as signed out", async () => {
    const { c, calls } = client([{ data: { user: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch" } }, ok]);
    expect((await loadSignedInProfile(c, "*", noWait)).status).toBe("ready");
    expect(calls.getUser).toBe(2);
  });

  it("a failed profiles query is retried, not treated as an empty profile", async () => {
    const { c, calls } = client([ok], [{ data: null, error: { message: "TypeError: Failed to fetch" } }, { data: PROFILE, error: null }]);
    expect(await loadSignedInProfile(c, "*", noWait)).toEqual({ status: "ready", user: USER, profile: PROFILE });
    expect(calls.profile).toBe(2);
  });

  it("persistent failure → status 'error' after 3 attempts (never 'ready' with a null profile)", async () => {
    const waits: number[] = [];
    const { c, calls } = client([new Error("network down")]);
    const res = await loadSignedInProfile(c, "*", { wait: async (ms) => { waits.push(ms); } });
    expect(res).toEqual({ status: "error", message: "network down" });
    expect(calls.getUser).toBe(3);
    expect(waits).toEqual([600, 1500]);
  });

  it("signed out (no session) is a definite answer, not retried", async () => {
    const { c, calls } = client([{ data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!" } }]);
    expect(await loadSignedInProfile(c, "*", noWait)).toEqual({ status: "signed_out" });
    expect(calls.getUser).toBe(1);
    expect(calls.profile).toBe(0);
  });

  it("a user with no profile row yet is 'ready' with profile null (genuinely incomplete)", async () => {
    const { c } = client([ok], [{ data: null, error: null }]);
    expect(await loadSignedInProfile(c, "*", noWait)).toEqual({ status: "ready", user: USER, profile: null });
  });
});

describe("withRetry", () => {
  it("returns the first success and rethrows the last error", async () => {
    let n = 0;
    await expect(withRetry(async () => { if (++n < 2) throw new Error("x"); return n; }, { wait: async () => {} })).resolves.toBe(2);
    await expect(withRetry(async () => { throw new Error("always"); }, { delays: [1], wait: async () => {} })).rejects.toThrow("always");
  });
});

describe("wiring (source)", () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const page = read("app", "(app)", "create", "page.tsx");
  const stepper = read("components", "nav", "GlobalStepper.tsx");

  it("create page loads through the retrying loader, and a failed plan query is an error, not 'no plan'", () => {
    expect(page).toMatch(/loadSignedInProfile<Profile>\(supabase, "\*"\)/);
    expect(page).not.toMatch(/auth\.getUser\(\)\.then/);
    expect(page).not.toMatch(/from\("profiles"\)\.select\("\*"\)\.eq\("user_id", user\.id\)\.single\(\)/);
    expect(page).toMatch(/if \(error\) throw new Error\(error\.message\);/);
  });

  it("create page never says 'Profile incomplete' before the profile has loaded; a failure offers Retry", () => {
    const occurrences = page.split("Profile incomplete.{\" \"}").length - 1;
    expect(occurrences).toBe(2);
    for (const chunk of page.split("Profile incomplete.{\" \"}").slice(0, -1)) {
      const before = chunk.slice(-500);
      expect(before).toMatch(/loadError \? \(/);
      expect(before).toMatch(/!loaded \? \(/);
    }
    expect(page.match(/onClick=\{retryLoad\}/g)?.length).toBe(3);
  });

  it("stepper: a failed load does not mark steps incomplete or redirect (loaded stays false)", () => {
    expect(stepper).toMatch(/loadSignedInProfile</);
    expect(stepper).toMatch(/if \(res\.status === "error"\) \{ setLoadFailed\(true\); return; \}/);
    expect(stepper).not.toMatch(/catch \{ setLoaded\(true\); \}/);
    expect(stepper).not.toMatch(/\.single\(\)/);
  });
});
