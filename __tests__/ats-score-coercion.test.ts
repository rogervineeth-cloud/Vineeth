/**
 * normaliseGeneratedResume — ats_score coercion.
 *
 * Split out because the score is the one field with a fail-hard policy, and
 * the failure mode is subtle: Number("") and Number("   ") are both 0, and 0
 * is finite. A naive coercion therefore turns "the model gave us no score"
 * into "the candidate scored zero" — which the dashboard renders as a red 0
 * and the preview as an empty dial. That is precisely the misleading outcome
 * the fail-hard policy exists to prevent, so blank and whitespace-only strings
 * must be fatal rather than clamped.
 */
import { normaliseGeneratedResume, type ResumeShape } from "@/lib/sanitise-resume";

const FALLBACK_ROLE = "Backend Engineer";

/** Minimal resume carrying only the score under test. */
function withScore(ats_score: unknown): ResumeShape {
  // Cast through unknown: ResumeShape types ats_score as a number, but the
  // whole point of these cases is values a model might actually emit.
  return { ats_score, tailored_role: "Backend Engineer", matched_keywords: [], missing_keywords: [] } as unknown as ResumeShape;
}

function run(ats_score: unknown) {
  return normaliseGeneratedResume(withScore(ats_score), FALLBACK_ROLE);
}

describe("ats_score — blank and whitespace strings are fatal", () => {
  it.each([
    ["empty string", ""],
    ["single space", " "],
    ["multiple spaces", "     "],
    ["tab and newline", "\t\n"],
    ["non-breaking-ish whitespace mix", " \t \n "],
  ])("%s is rejected, not coerced to 0", (_label, value) => {
    const { fatal, resume } = run(value);
    expect(fatal).toContain("ats_score");
    // Must NOT have been rewritten into a plausible-looking score.
    expect(resume.ats_score).not.toBe(0);
  });
});

describe("ats_score — valid numeric strings are accepted", () => {
  it('"78" is accepted as the number 78', () => {
    const { fatal, resume } = run("78");
    expect(fatal).toEqual([]);
    expect(resume.ats_score).toBe(78);
    expect(typeof resume.ats_score).toBe("number");
  });

  it('"  78  " is tolerated — surrounding whitespace is trimmed', () => {
    const { fatal, resume } = run("  78  ");
    expect(fatal).toEqual([]);
    expect(resume.ats_score).toBe(78);
  });

  it('"0" is a legitimate score and is kept, unlike a blank string', () => {
    const { fatal, resume } = run("0");
    expect(fatal).toEqual([]);
    expect(resume.ats_score).toBe(0);
  });
});

describe("ats_score — NaN and infinities are fatal", () => {
  it.each([
    ["NaN number", NaN],
    ["Infinity number", Infinity],
    ["-Infinity number", -Infinity],
    ['"NaN" string', "NaN"],
    ['"Infinity" string', "Infinity"],
    ['"abc" string', "abc"],
    ['"78abc" string', "78abc"],
  ])("%s is rejected", (_label, value) => {
    expect(run(value).fatal).toContain("ats_score");
  });
});

describe("ats_score — non-numeric types are fatal", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["true", true],
    ["false", false],
    ["empty array", []],
    ["object", {}],
  ])("%s is rejected", (_label, value) => {
    expect(run(value).fatal).toContain("ats_score");
  });

  it("false is not silently coerced to 0", () => {
    // Number(false) === 0; the type guard must catch this before coercion.
    expect(run(false).resume.ats_score).not.toBe(0);
  });
});

describe("ats_score — out-of-range values are fatal, never clamped", () => {
  // Clamping -5 to 0 produces the same misleading red zero as a blank score,
  // and clamping 142 to 100 manufactures a perfect result the model never
  // claimed. A value outside 0..100 means the output contract was ignored.
  it.each([
    ["negative", -5],
    ["just below zero", -1],
    ["just above the ceiling", 101],
    ["well above the ceiling", 142],
    ["absurdly high", 10_000],
    ["negative numeric string", "-5"],
    ["numeric string just over", "101"],
    ["numeric string well over", "142"],
  ])("%s is rejected", (_label, value) => {
    expect(run(value).fatal).toContain("ats_score");
  });

  it.each([
    ["-5", -5],
    ["142", 142],
    ['"-5"', "-5"],
    ['"142"', "142"],
  ])("%s is not silently rewritten into a valid-looking score", (_label, value) => {
    const { resume } = run(value);
    expect(resume.ats_score).not.toBe(0);
    expect(resume.ats_score).not.toBe(100);
  });

  it("checks the range before rounding, so the boundary is consistent", () => {
    // 100.4 would round back into range and 100.6 would not. Both are
    // contract violations; neither should sneak through on a rounding quirk.
    expect(run(100.4).fatal).toContain("ats_score");
    expect(run(100.6).fatal).toContain("ats_score");
    expect(run(-0.4).fatal).toContain("ats_score");
  });
});

describe("ats_score — in-range values are kept and rounded", () => {
  it.each([
    ["exactly 0", 0, 0],
    ["exactly 100", 100, 100],
    ["rounds up", 78.6, 79],
    ["rounds down", 78.4, 78],
    ["rounds half up", 45.5, 46],
    ["numeric string decimal", "61.7", 62],
  ])("%s -> %s becomes %s", (_label, input, expected) => {
    const { fatal, resume } = run(input);
    expect(fatal).toEqual([]);
    expect(resume.ats_score).toBe(expected);
  });

  it("always yields an integer for in-range input", () => {
    for (const v of [12.3, 45.5, 99.99, "61.7"]) {
      const { fatal, resume } = run(v);
      expect(fatal).toEqual([]);
      expect(Number.isInteger(resume.ats_score as number)).toBe(true);
    }
  });
});

describe("normaliseGeneratedResume — a fatal score blocks nothing else from being repaired", () => {
  it("still reports repairable fields alongside the fatal one", () => {
    const { fatal, repaired, resume } = normaliseGeneratedResume(
      { ats_score: "   ", summary: "x" } as unknown as ResumeShape,
      FALLBACK_ROLE
    );
    expect(fatal).toContain("ats_score");
    expect(repaired).toEqual(expect.arrayContaining(["matched_keywords", "missing_keywords", "tailored_role"]));
    expect(resume.tailored_role).toBe(FALLBACK_ROLE);
  });
});
