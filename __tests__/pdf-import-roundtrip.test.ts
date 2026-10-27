/**
 * Importing this app's OWN PDF (Profile > Upload PDF) must give back the
 * fields it was rendered from.
 *
 * Production QA, 27 Oct 2026 (main 1f55cdb): the Compact PDF of resume
 * 59c24878 imported as
 *   company     "Zoho Corporation Chennai"          (location lost)
 *   institution "College of Engineering Trivandrum · 8.4 CGPA Thiruvananthapuram, Kerala"
 *   degree      "B.Tech Computer Science 2022-2026", year "2022", grade/location blank.
 * Cause: the renderer puts locations and dates flush right on the same line,
 * pdf.js reports the space between as one wide blank item, and the route
 * joined it with a single space. lib/pdf-text now keeps a wide gap as a column
 * boundary (TAB) that the experience and education parsers read.
 *
 * __tests__/fixtures/roundtrip-compact.pdf is that layout, rendered at 1f55cdb
 * from __tests__/helpers/roundtrip-resume.ts (fictional values, same shape).
 * Text is read with the same pdf.js build and options as the route, in a
 * child process (pdfjs is ESM-only).
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { assemblePdfText, COLUMN_GAP, type PdfTextItem } from "@/lib/pdf-text";
import { extractProfile, parseExperienceBlock, parseEducationBlock, parseSkillsBlock, columnCells } from "@/lib/resume-parser";
import { renderResumePdf, type ResumeJson, type ContactDetails } from "@/lib/resume-pdf";
import { FIXTURES } from "./helpers/resume-fixtures";
import { ROUNDTRIP_CONTACT, ROUNDTRIP_RESUME } from "./helpers/roundtrip-resume";

const ITEMS = path.join(__dirname, "helpers", "pdf-items.mjs");
const FIXTURE = path.join(__dirname, "fixtures", "roundtrip-compact.pdf");
const pdfItems = (files: string[]): PdfTextItem[][][] =>
  JSON.parse(execFileSync("node", [ITEMS, ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const importText = (pages: PdfTextItem[][]) => pages.map(assemblePdfText).join("\n");

describe("the QA fixture (Compact PDF, production layout) imports field for field", () => {
  const [pages] = pdfItems([FIXTURE]);
  const p = extractProfile(importText(pages));

  it("experience: employer and location separate", () => {
    expect(p.experience).toEqual([{
      company: "Zoho Corporation", role: "Product Analyst", duration: "Jun 2025 - Present", location: "Chennai",
      bullets: ROUNDTRIP_RESUME.experience![0].bullets,
    }]);
  });

  it("education: institution, degree, year range, grade and location separate", () => {
    expect(p.education).toEqual([{
      institution: "College of Engineering Trivandrum", degree: "B.Tech Computer Science", year: "2022-2026",
      location: "Thiruvananthapuram, Kerala", cgpa: "8.4 CGPA",
    }]);
  });

  it("contact, summary and skills still import as before", () => {
    expect([p.name, p.email, p.phone, p.city]).toEqual(["Aarav Menon", "aarav.qa@example.com", "+91 98470 00000", "Chennai"]);
    expect(p.summary).toBe(ROUNDTRIP_RESUME.summary);
    expect(p.skills).toEqual(ROUNDTRIP_RESUME.skills);
  });

  it("the text the route builds marks the right-aligned columns", () => {
    const lines = importText(pages).split("\n");
    expect(lines).toEqual(expect.arrayContaining([
      `Product Analyst${COLUMN_GAP}Jun 2025 - Present`,
      `Zoho Corporation${COLUMN_GAP}Chennai`,
      `B.Tech Computer Science${COLUMN_GAP}2022-2026`,
      `College of Engineering Trivandrum · 8.4 CGPA${COLUMN_GAP}Thiruvananthapuram, Kerala`,
    ]));
  });
});

describe("every style × profile the app renders imports back to its experience and education", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "import-roundtrip-"));
  const all: { id: string; contact: ContactDetails; resume: ResumeJson }[] = [...FIXTURES, { id: "qa-roundtrip", contact: ROUNDTRIP_CONTACT, resume: ROUNDTRIP_RESUME }];
  const cases = ["classic", "modern", "compact", "executive"].flatMap((style) => all.map((f) => ({ style, f, file: path.join(dir, `${style}-${f.id}.pdf`) })));
  let extracted: PdfTextItem[][][] = [];

  beforeAll(async () => {
    for (const c of cases) fs.writeFileSync(c.file, await renderResumePdf(c.f.resume, c.f.contact, c.style));
    extracted = pdfItems(cases.map((c) => c.file));
  }, 60_000);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each(cases.map((c, i) => [`${c.style} × ${c.f.id}`, i] as const))("%s", (_label, i) => {
    const { f } = cases[i];
    const p = extractProfile(importText(extracted[i]));
    expect(p.experience.map((e) => [e.company, e.role, e.duration, e.location]))
      .toEqual((f.resume.experience ?? []).map((e) => [e.company, e.role, e.duration, e.location]));
    // Every bullet word arrives, in order. (A bullet that WRAPS still imports
    // as two bullets — pre-existing, outside this fix; see the todo below.)
    expect(p.experience.map((e) => e.bullets.join(" "))).toEqual((f.resume.experience ?? []).map((e) => e.bullets.join(" ")));
    expect(p.education.map((e) => [e.institution, e.degree, e.year, e.location, e.cgpa ?? ""]))
      .toEqual((f.resume.education ?? []).map((e) => [e.institution, e.degree, e.year, e.location, e.cgpa ?? ""]));
  });
});

it.todo("a bullet that wraps onto a second line imports as ONE bullet (today: two)");

describe("assemblePdfText", () => {
  const it_ = (str: string, x: number, y: number, width: number, hasEOL = false): PdfTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width, hasEOL });

  it("a wide blank item between same-line text is a column gap; a narrow one is a space", () => {
    expect(assemblePdfText([it_("Zoho", 40, 600, 30), it_(" ", 70, 600, 400), it_("Chennai", 480, 600, 35)])).toBe("Zoho\tChennai");
    expect(assemblePdfText([it_("Built", 40, 600, 25), it_(" ", 65, 600, 3), it_("APIs", 68, 600, 20)])).toBe("Built APIs");
  });

  it("a wide jump in x with no blank item is a gap too; adjacent items get a space", () => {
    expect(assemblePdfText([it_("B.Tech", 40, 500, 35), it_("2022", 500, 500, 22)])).toBe("B.Tech\t2022");
    expect(assemblePdfText([it_("New", 40, 500, 20), it_("Delhi", 62, 500, 25)])).toBe("New Delhi");
  });

  it("lines break on a change of y and on hasEOL, as before", () => {
    expect(assemblePdfText([it_("A", 40, 700, 10), it_("B", 40, 680, 10)])).toBe("A\nB");
    expect(assemblePdfText([it_("A", 40, 700, 10, true), it_("B", 40, 700, 10)])).toBe("A\nB");
    expect(assemblePdfText([{ str: undefined }, it_("A", 40, 700, 10)])).toBe("A");
  });

  it("the route builds its text with it", () => {
    const route = fs.readFileSync(path.join(__dirname, "..", "app", "api", "parse-resume", "route.ts"), "utf8");
    expect(route).toMatch(/pagesText\.push\(assemblePdfText\(content\.items as PdfTextItem\[\]\)\);/);
  });
});

describe("column gaps are read only where they mean something", () => {
  it("experience: Title<gap>dates then Employer<gap>Location", () => {
    expect(parseExperienceBlock(["Role 1 Title\t2024 - 2025", "Employer 1 Pvt Ltd\tMumbai", "• Did a thing."])).toEqual([
      { company: "Employer 1 Pvt Ltd", role: "Role 1 Title", duration: "2024 - 2025", location: "Mumbai", bullets: ["Did a thing."] },
    ]);
  });

  it("experience: Company<gap>dates then Role<gap>Location (other templates)", () => {
    expect(parseExperienceBlock(["Infosys\tJul 2021 - Present", "Software Engineer\tPune"])[0]).toMatchObject({ company: "Infosys", role: "Software Engineer", location: "Pune" });
  });

  it("education: grade forms and an institution-first layout", () => {
    expect(parseEducationBlock(["Model Engineering College\t2022 - 2026", "CGPA 8.4\tKochi"])).toEqual([
      { institution: "Model Engineering College", degree: "", year: "2022 - 2026", location: "Kochi", cgpa: "8.4" },
    ]);
    expect(parseEducationBlock(["Class XII (CBSE)\t2022", "Govt. Higher Secondary School · 92%\tThrissur"])[0]).toMatchObject({ institution: "Govt. Higher Secondary School", cgpa: "92%", location: "Thrissur" });
  });

  it("lines without a gap parse exactly as before", () => {
    expect(parseEducationBlock(["Indian Institute of Technology, Madras", "B.Tech Computer Science, 2022", "CGPA: 8.7"])).toEqual(
      parseEducationBlock(["Indian Institute of Technology, Madras", "B.Tech Computer Science, 2022", "CGPA: 8.7"].map((l) => l.replace(/\t/g, " "))),
    );
  });

  it("anywhere else a gap is a plain space (skills, headings)", () => {
    const p = extractProfile("Asha Rao\nasha@example.com\nSKILLS\nPython\tSQL\nEXPERIENCE\nAnalyst\tJan 2024 - Present\nAcme Ltd\tPune");
    expect(p.skills.join(" ")).not.toMatch(/\t/);
    expect(parseSkillsBlock(["Python SQL"])).toEqual(parseSkillsBlock(["Python SQL"]));
    expect(p.experience[0]).toMatchObject({ role: "Analyst", company: "Acme Ltd", location: "Pune" });
    expect(columnCells("Zoho Corporation\tChennai")).toEqual(["Zoho Corporation", "Chennai"]);
  });
});
