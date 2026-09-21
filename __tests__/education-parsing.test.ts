// Education parsing guard.
//
// An imported profile in production ended up with ~30 "education" entries
// containing "References", a referee's name and email, banner headings like
// "C E R T I F I C A T I O N" and "Languages & Tools", and whole project
// descriptions. Once the section classifier mis-files a line under education,
// the parser turns it into a qualification.
import { parseEducationBlock } from "@/lib/resume-parser";

describe("parseEducationBlock", () => {
  it("keeps genuine qualifications", () => {
    const out = parseEducationBlock([
      "Indian Institute of Technology, Madras",
      "B.Tech Computer Science, 2022",
      "CGPA: 8.7",
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].institution || out[0].degree).toMatch(/Technology|B\.Tech/);
  });

  it("drops referee contact details", () => {
    const out = parseEducationBlock([
      "References",
      "Dr. Anil Kumar",
      "anil.kumar@example.com",
      "+91 98765 43210",
    ]);
    expect(out.every((e) => !/@/.test(e.institution + e.degree))).toBe(true);
    expect(out.every((e) => !/^references$/i.test(e.institution.trim()))).toBe(true);
  });

  it("drops spaced-out banner headings", () => {
    const out = parseEducationBlock(["C E R T I F I C A T I O N"]);
    expect(out).toHaveLength(0);
  });

  it("drops mis-filed section headings", () => {
    const out = parseEducationBlock(["Languages & Tools", "Projects", "Skills:"]);
    expect(out).toHaveLength(0);
  });

  it("drops a full sentence mis-filed as a qualification", () => {
    const out = parseEducationBlock([
      "Used GPT-4 and Python in Colab to automate student report generation and data insight extraction across several cohorts and subjects this year",
    ]);
    expect(out).toHaveLength(0);
  });

  it("caps runaway output — nobody has 30 degrees", () => {
    const noise = Array.from({ length: 40 }, (_, i) => `Some Institute Number ${i}`);
    expect(parseEducationBlock(noise).length).toBeLessThanOrEqual(8);
  });

  it("never throws on empty input", () => {
    expect(parseEducationBlock([])).toEqual([]);
  });
});
