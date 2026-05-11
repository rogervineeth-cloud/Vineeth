// Per-download price MUST be strictly decreasing as plan tier grows.
// Expected (do not display to users):
//   single      99 / 1  = 99.00
//   fresher    269 / 5  = 53.80
//   job_hunter 599 / 12 = 49.92
//   career     999 / 25 = 39.96
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

  it("has strictly decreasing per-download price across the tiers", () => {
    const perDownload = PLANS.map((p) => p.priceInr / p.downloads);
    for (let i = 1; i < perDownload.length; i++) {
      expect(perDownload[i]).toBeLessThan(perDownload[i - 1]);
    }
  });

  it("matches the expected per-download table to 2 decimals", () => {
    const expected: Record<string, number> = {
      single: 99.0,
      fresher: 53.8,
      job_hunter: 49.92,
      career: 39.96,
    };
    for (const p of PLANS) {
      expect(Number((p.priceInr / p.downloads).toFixed(2))).toBe(expected[p.type]);
    }
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
