/**
 * Unit tests for the trim-instead-of-revert helpers (lib/detail-evidence.ts
 * trimToEvidence, lib/resume-generation.ts maskSoughtRole / fixAdviceCounts).
 */
import { Evidence, novelDetail, trimToEvidence } from "@/lib/detail-evidence";
import { maskSoughtRole, fixAdviceCounts } from "@/lib/resume-generation";

const SOURCE = "Cut cost per acquisition from Rs 640 to Rs 410 by restructuring ad sets and testing 25 creatives.";
const ev = new Evidence("Digital Marketing Executive", SOURCE, "Built weekly ROAS reports in Google Analytics and Excel for the founders.");
const trim = (t: string, source = SOURCE) => trimToEvidence(t, { source, novel: (x) => novelDetail(x, ev) });

describe("trimToEvidence", () => {
  it("removes a trailing unsupported clause", () => {
    expect(trim("Reduced cost per acquisition from Rs 640 to Rs 410 by testing 25 creatives and restructuring ad sets, improving overall ROAS.")).toBe(
      "Reduced cost per acquisition from Rs 640 to Rs 410 by testing 25 creatives and restructuring ad sets."
    );
    // Without "restructuring ad sets" the remainder says too little of the source.
    expect(trim("Reduced cost per acquisition from Rs 640 to Rs 410 by testing 25 creatives, improving overall ROAS.")).toBeNull();
  });

  it("removes an unsupported modifier of an evidenced word", () => {
    expect(trim("Cut cost per acquisition from Rs 640 to Rs 410 by testing 25 bold creatives and restructuring ad sets.")).toBe(
      "Cut cost per acquisition from Rs 640 to Rs 410 by testing 25 creatives and restructuring ad sets."
    );
  });

  it("never drops a number of the source", () => {
    // The only supported remainder would lose "25".
    expect(trim("Cut cost per acquisition from Rs 640 to Rs 410 by testing twenty-five creatives.")).toBeNull();
  });

  it("refuses a remainder that says much less than the source (revert keeps more truth)", () => {
    expect(trim("Cut cost per acquisition from Rs 640 to Rs 410 using AI bidding.")).toBeNull();
  });

  it("refuses a dangling result", () => {
    const src = "Sourced candidates on Naukri and screened 60 profiles a week.";
    const e = new Evidence(src);
    const r = trimToEvidence("Sourced candidates on Naukri, screening 60 profiles a week and partnering with hiring managers.", {
      source: src, novel: (x) => novelDetail(x, e),
    });
    expect(r).toBe("Sourced candidates on Naukri, screening 60 profiles a week.");
  });

  it("does not delete one noun of a coordination ('PPAP and APQP files')", () => {
    const src = "Prepared PPAP files for 9 new parts.";
    const e = new Evidence(src);
    expect(trimToEvidence("Prepared PPAP and APQP files for 9 new parts.", { source: src, novel: (x) => novelDetail(x, e) })).toBeNull();
  });

  it("restores a source verb only for a verb", () => {
    const src = "Cleaned 3 years of POS data in Python.";
    const e = new Evidence(src);
    expect(trimToEvidence("Prepared 3 years of POS data in Python.", { source: src, novel: (x) => novelDetail(x, e) })).toBe(
      "Cleaned 3 years of POS data in Python."
    );
    const p = "Figma prototype of a 6-screen app, tested with 8 classmates.";
    const pe = new Evidence(p);
    expect(trimToEvidence("High-fidelity Figma prototype of a 6-screen app, tested with 8 classmates.", { source: p, novel: (x) => novelDetail(x, pe) }))
      .toBe(p);
  });

  it("returns null when nothing can be removed safely", () => {
    expect(trim("Architected a real-time bidding platform.")).toBeNull();
  });
});

describe("maskSoughtRole", () => {
  it("masks the role only where it is framed as sought", () => {
    expect(maskSoughtRole("Designer, seeking the UI/UX Designer role.", "UI/UX Designer")).not.toMatch(/UI\/UX/);
    expect(maskSoughtRole("UI/UX Designer with 3 years.", "UI/UX Designer")).toBe("UI/UX Designer with 3 years.");
    expect(maskSoughtRole("Applying for the Financial Analyst (FP&A) role.", "Financial Analyst (FP&A)")).not.toMatch(/FP&A/);
  });
});

describe("fixAdviceCounts", () => {
  it("corrects a count to the listed items", () => {
    expect(fixAdviceCounts("You lack experience in 8 of the 10 curated keywords (A, B, C, D, E, F, G, H, I).")).toBe(
      "You lack experience in 9 of the 10 curated keywords (A, B, C, D, E, F, G, H, I)."
    );
    expect(fixAdviceCounts("You meet 3 of the 5 requirements (Salesforce, negotiation).")).toBe("You meet 2 of the 5 requirements (Salesforce, negotiation).");
  });

  it("drops the total when the list is longer than it", () => {
    expect(fixAdviceCounts("You meet 2 of the 3 requirements (A, B, C and D).")).toBe("You meet 4 requirements (A, B, C and D).");
  });

  it("leaves consistent counts and non-lists alone", () => {
    const ok = "Your profile covers 3 of the 4 core skills (SQL, Excel, Power BI).";
    expect(fixAdviceCounts(ok)).toBe(ok);
    expect(fixAdviceCounts("You have 2 of the 3 (Java).")).toBe("You have 2 of the 3 (Java).");
  });
});
