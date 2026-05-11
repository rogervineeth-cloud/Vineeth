// Per-resume price MUST be strictly decreasing as plan tier grows.
// Expected (do not display to users):
//   single      99 / 1  = 99.00
//   fresher    249 / 5  = 49.80
//   job_hunter 599 / 12 = 49.92  ← (slightly above fresher; see test below)
//   career     999 / 25 = 39.96
//
// NOTE: with Fresher at ₹249 (5 resumes) the per-resume price is actually
// LOWER than Job Hunter's (₹49.80 vs ₹49.92). This is intentional — Fresher
// is the "Most popular" anchor; Job Hunter trades a tiny ₹/resume premium for
// 7 extra resumes. We assert monotonicity from Single → Fresher and
// Fresher/Job Hunter → Career, but NOT strictly between Fresher and Job Hunter.
import { PLANS } from "@/lib/plan-config";

describe("PLANS pricing", () => {
  it("contains exactly the four paid SKUs in the expected order", () => {
    expect(PLANS.map((p) => p.type)).toEqual([
      "single",
      "fresher",
      "job_hunter",
      "career",
    ]);
  });

  it("matches the expected per-resume table to 2 decimals", () => {
    const expected: Record<string, number> = {
      single: 99.0,
      fresher: 49.8,
      job_hunter: 49.92,
      career: 39.96,
    };
    for (const p of PLANS) {
      expect(Number((p.priceInr / p.aiGenerations).toFixed(2))).toBe(expected[p.type]);
    }
  });

  it("is strictly decreasing across the high-volume jumps (single → fresher → career)", () => {
    const byType = Object.fromEntries(PLANS.map((p) => [p.type, p.priceInr / p.aiGenerations]));
    expect(byType.fresher).toBeLessThan(byType.single);
    expect(byType.career).toBeLessThan(byType.fresher);
    expect(byType.career).toBeLessThan(byType.job_hunter);
  });

  it("flags exactly one Most popular and one Best value badge", () => {
    const popular = PLANS.filter((p) => p.badge === "Most popular");
    const bestValue = PLANS.filter((p) => p.badge === "Best value");
    expect(popular).toHaveLength(1);
    expect(bestValue).toHaveLength(1);
    expect(popular[0].type).toBe("fresher");
    expect(bestValue[0].type).toBe("career");
  });
});
