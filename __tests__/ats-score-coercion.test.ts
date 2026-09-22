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

describe("ats_score — in-range values are clamped and rounded", () => {
  it.each([
    ["above range", 142, 100],
    ["far above range", 10_000, 100],
    ["below range", -5, 0],
    ["exactly 0", 0, 0],
    ["exactly 100", 100, 100],
    ["rounds up", 78.6, 79],
    ["rounds down", 78.4, 78],
    ["numeric string above range", "142", 100],
  ])("%s -> %s becomes %s", (_label, input, expected) => {
    const { fatal, resume } = run(input);
    expect(fatal).toEqual([]);
    expect(resume.ats_score).toBe(expected);
  });

  it("always yields an integer", () => {
    for (const v of [12.3, 45.5, 99.99, "61.7"]) {
      const score = run(v).resume.ats_score as number;
      expect(Number.isInteger(score)).toBe(true);
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
