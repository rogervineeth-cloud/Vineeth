/**
 * Final release cleanup (manual QA findings):
 *   1. Stepper "Job Desc" from Template: the stepper highlighted Job Desc but
 *      the page stayed on Template — the page read ?step= once on mount.
 *   2. A benign 409 GENERATION_IN_PROGRESS was shown under "Something went
 *      wrong".
 *   3. Backspace in the empty "+ add skill" input removed the 12th visible
 *      chip, not the last one; a hand-added chip could be hidden behind
 *      "+N more" and the next hidden chip slid into the removed one's place.
 *   4. The API accepted 100-199 character JDs ("min 100 chars") while the page
 *      requires 200.
 * Jest has no DOM here: helpers are tested directly, the route through its
 * handler, and page wiring by reading the source.
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { createStepFromParam, createStepHref, CREATE_STEP_PARAM } from "@/lib/create-steps";
import { isAlreadyGenerating, ALREADY_GENERATING } from "@/lib/generation-feedback";
import { effectiveJdKeywords, withoutKeyword } from "@/lib/jd-keywords";
import { shouldRemoveLastChip } from "@/lib/chip-input";
import { JD_MIN_CHARS } from "@/lib/jd-length";

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
  createServiceClient: jest.fn(async () => ({})),
}));
import { POST as generate } from "@/app/api/generate-resume/route";

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const PAGE = read("app", "(app)", "create", "page.tsx");
const STEPPER = read("components", "nav", "GlobalStepper.tsx");

describe("1. the page shows the step the URL (and the stepper) says", () => {
  it("maps ?step= the same way for page and stepper", () => {
    expect([null, "", "jd", "bogus", "template", "review", "resume"].map(createStepFromParam)).toEqual([1, 1, 1, 1, 2, 3, 4]);
    for (const [n, param] of Object.entries(CREATE_STEP_PARAM)) expect(createStepFromParam(param)).toBe(Number(n));
  });

  it("stepper links keep ?regen= so a regeneration is not dropped", () => {
    expect(createStepHref("step=template&regen=abc", 1)).toBe("/create?regen=abc");
    expect(createStepHref("regen=abc", 3)).toBe("/create?regen=abc&step=review");
    expect(createStepHref("step=review", 1)).toBe("/create");
    expect(createStepHref("", 2)).toBe("/create?step=template");
  });

  it("the page follows ?step= after mount (not read once from window.location)", () => {
    expect(PAGE).toMatch(/const stepParam = searchParams\.get\("step"\);/);
    expect(PAGE).toMatch(/if \(stepParam !== syncedStepParam\) \{\s*setSyncedStepParam\(stepParam\);\s*setFlowStep\(createStepFromParam\(stepParam\)\);/);
    expect(PAGE).not.toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("step"\)/);
  });

  it("the stepper uses the same mapping and builds /create links from the current query", () => {
    expect(STEPPER).toMatch(/return 4 \+ createStepFromParam\(stepParam\)/);
    expect(STEPPER).toMatch(/createStepHref\(searchParams\.toString\(\), \(i - 4\) as CreateStep\)/);
  });
});

describe("2. 'already generating' is its own calm state", () => {
  it("recognises only a 409 GENERATION_IN_PROGRESS", () => {
    expect(isAlreadyGenerating(409, { error: "GENERATION_IN_PROGRESS" })).toBe(true);
    expect(isAlreadyGenerating(409, { error: "GENERATION_EXPIRED" })).toBe(false);
    expect(isAlreadyGenerating(409, { error: "IDEMPOTENCY_KEY_REUSED" })).toBe(false);
    expect(isAlreadyGenerating(500, { error: "GENERATION_IN_PROGRESS" })).toBe(false);
    expect(isAlreadyGenerating(409, null)).toBe(false);
  });

  it("the copy says what is happening and that no credit is used", () => {
    expect(ALREADY_GENERATING.title).not.toMatch(/wrong|error|fail/i);
    expect(ALREADY_GENERATING.message).toMatch(/another tab/);
    expect(ALREADY_GENERATING.message).toMatch(/no extra credit/);
  });

  it("the page routes it to that state (with Dashboard and Back to review), not to genError", () => {
    const branch = PAGE.slice(PAGE.indexOf("if (isAlreadyGenerating(res.status, data)) {"));
    expect(branch.slice(0, branch.indexOf("return;"))).toMatch(/setAlreadyGenerating\(true\)/);
    expect(branch.slice(0, branch.indexOf("return;"))).not.toMatch(/setGenError/);
    const view = PAGE.slice(PAGE.indexOf(") : alreadyGenerating ? ("), PAGE.indexOf(") : genError ? ("));
    expect(view).toMatch(/ALREADY_GENERATING\.title/);
    expect(view).toMatch(/router\.push\("\/dashboard"\)/);
    expect(view).toMatch(/Back to review/);
    expect(view).not.toMatch(/Something went wrong/);
    expect(view).toMatch(/role="status"/);
  });
});

describe("3. Backspace removes the last chip", () => {
  const detected = Array.from({ length: 14 }, (_, i) => `Skill${i + 1}`);
  const key = { key: "Backspace" };

  it("with more than 12 chips, Backspace removes the hand-added last chip — exactly one chip", () => {
    let removed = new Set<string>();
    let extras = ["Looker"];
    const chips = effectiveJdKeywords(detected, removed, extras);
    expect(chips[chips.length - 1]).toBe("Looker");
    expect(shouldRemoveLastChip(key, "", chips.length)).toBe(true);
    ({ removed, extras } = withoutKeyword(removed, extras, chips[chips.length - 1]));
    const after = effectiveJdKeywords(detected, removed, extras);
    expect(after).toEqual(detected);
    // Next Backspace removes the last detected one, and it stays removed.
    ({ removed, extras } = withoutKeyword(removed, extras, after[after.length - 1]));
    expect(effectiveJdKeywords(detected, removed, extras)).toEqual(detected.slice(0, -1));
  });

  it("re-adding a removed detected keyword brings it back once", () => {
    const { removed, extras } = withoutKeyword(new Set(), [], "Skill3");
    expect(effectiveJdKeywords(detected, removed, [...extras, "skill3"])).toHaveLength(detected.length);
  });

  it("the page shows every chip and Backspace targets the last of them", () => {
    const jdStep = PAGE.slice(PAGE.indexOf("Detected skills:"), PAGE.indexOf('placeholder="+ add skill"'));
    expect(jdStep).toMatch(/\{effectiveKeywords\.map\(\(kw\) => \(/);
    expect(jdStep).not.toMatch(/slice\(0, 12\)/);
    expect(jdStep).not.toMatch(/more<\/span>/);
    expect(jdStep).toMatch(/removeKeyword\(effectiveKeywords\[effectiveKeywords\.length - 1\]\)/);
    expect(jdStep).toMatch(/onClick=\{\(\) => removeKeyword\(kw\)\}/);
  });
});

describe("4. the API enforces the same 200-character minimum, with the same wording", () => {
  const post = (jd: string) =>
    generate(new Request("http://localhost/api/generate-resume", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_key: "3f1c7a0e-8f53-4d6a-9a53-2d7f1e6b1c11", jd_text: jd, user_profile: { full_name: "Aarav Menon", email: "aarav@example.com" } }),
    }) as unknown as NextRequest);

  it.each([100, 150, 199])("%i characters → 400 naming the 200-character minimum", async (n) => {
    const res = await post("x".repeat(n));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain(`at least ${JD_MIN_CHARS} characters`);
    expect(error).not.toMatch(/100/);
  });

  it("surrounding whitespace does not count (as on the page)", async () => {
    expect((await post(`   ${"x".repeat(199)}   \n`)).status).toBe(400);
  });

  it("200 characters passes validation (then stops at auth here: 401)", async () => {
    expect((await post("x".repeat(200))).status).toBe(401);
  });
});
