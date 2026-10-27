/**
 * Importing this app's OWN PDF (Profile > Upload PDF) must give back the
 * fields it was rendered from.
 *
 * Production QA, 27 Oct 2026 (main 1f55cdb): the Compact PDF of resume
 * 59c24878 imported as
 *   company     "Zoho Corporation Chennai"          (location lost)
 *   institution "College of Engineering Trivandrum · 8.4 CGPA Thiruvananthapuram, Kerala"
 *   degree      "B.Tech Computer Science 2022-2026", year "2022", grade/location blank.
 * A bullet that wrapped onto a second line also imported as two bullets.
 *
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
import { assemblePdfText, assemblePdfPages, COLUMN_GAP, type PdfTextItem } from "@/lib/pdf-text";
import { extractProfile, parseExperienceBlock, parseEducationBlock, parseSkillsBlock, parseProjectsBlock, columnCells } from "@/lib/resume-parser";
import { renderResumePdf, type ResumeJson, type ContactDetails } from "@/lib/resume-pdf";
import { FIXTURES } from "./helpers/resume-fixtures";
import { ROUNDTRIP_CONTACT, ROUNDTRIP_RESUME } from "./helpers/roundtrip-resume";

const ITEMS = path.join(__dirname, "helpers", "pdf-items.mjs");
const FIXTURE = path.join(__dirname, "fixtures", "roundtrip-compact.pdf");
const pdfItems = (files: string[]): PdfTextItem[][][] =>
  JSON.parse(execFileSync("node", [ITEMS, ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
/** main 1f55cdb's route line join, verbatim: newline on a y change, else one space. */
function legacyRouteJoin(items: PdfTextItem[]): string {
  let lastY: number | null = null;
  let buf = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const itemY: number | null = Array.isArray(item.transform) ? (item.transform as number[])[5] : null;
    if (lastY !== null && itemY !== null && Math.abs(itemY - lastY) > 1) buf += "\n";
    else if (buf && !buf.endsWith(" ") && !buf.endsWith("\n")) buf += " ";
    buf += item.str;
    if (item.hasEOL) buf += "\n";
    lastY = itemY;
  }
  return buf;
}

// Exactly what the route does (app/api/parse-resume extractTextFromPdf).
const importText = (pages: PdfTextItem[][]) => assemblePdfPages(pages);

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

  it("CampusEats imports as ONE project: name, full description, tech", () => {
    expect(p.projects).toEqual([{
      name: "CampusEats - Canteen Pre-order App",
      description: "Final-year capstone. Built a React Native app for pre-ordering canteen meals, cutting average queue time from 18 to 6 minutes for 1,200 students. Owned the product spec and ran the pilot with two canteens.",
      tech: ["React Native", "Firebase", "Node.js", "Figma"],
    }]);
  });

  it("the wrapped, quantified bullet imports as one bullet, exactly", () => {
    const wrapped = ROUNDTRIP_RESUME.experience![0].bullets[2];
    expect(wrapped).toMatch(/4\.2% to 0\.6%.*Rs\. 3\.5 lakh.*12,000.*\(3 regions\)\.$/);
    // It really does wrap in the fixture: two visual lines at the same x.
    const lines = pages[0].filter((i) => typeof i.str === "string" && /failed invoice|3 regions/.test(i.str as string));
    expect(lines).toHaveLength(2);
    expect(p.experience[0].bullets).toEqual(ROUNDTRIP_RESUME.experience![0].bullets);
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

  it("the long QA bullet wraps in every style (so the matrix exercises the join)", () => {
    cases.forEach((c, i) => {
      if (c.f.id !== "qa-roundtrip") return;
      const hits = extracted[i].flat().filter((it) => typeof it.str === "string" && /failed invoice|3 regions/.test(it.str as string));
      expect({ style: c.style, lines: hits.length }).toEqual({ style: c.style, lines: 2 });
    });
  });

  it.each(cases.map((c, i) => [`${c.style} × ${c.f.id}`, i] as const))("%s", (_label, i) => {
    const { f } = cases[i];
    const p = extractProfile(importText(extracted[i]));
    expect(p.experience.map((e) => [e.company, e.role, e.duration, e.location]))
      .toEqual((f.resume.experience ?? []).map((e) => [e.company, e.role, e.duration, e.location]));
    // Exactly: each bullet whole (wrapped ones joined), with its punctuation, in order.
    expect(p.experience.map((e) => e.bullets)).toEqual((f.resume.experience ?? []).map((e) => e.bullets));
    // Projects: one per source project — the " · " tech row is tech, not a second project.
    expect(p.projects).toEqual((f.resume.projects ?? []).map((pr) => ({ name: pr.name, description: pr.description, tech: pr.tech })));
    expect(p.education.map((e) => [e.institution, e.degree, e.year, e.location, e.cgpa ?? ""]))
      .toEqual((f.resume.education ?? []).map((e) => [e.institution, e.degree, e.year, e.location, e.cgpa ?? ""]));
  });
});

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
    expect(route).toMatch(/pageItems\.push\(content\.items as PdfTextItem\[\]\);/);
    expect(route).toMatch(/return assemblePdfPages\(pageItems\);/);
  });
});

describe("wrapped bullets: joined only on a hanging indent, never across distinct items", () => {
  const item = (str: string, x: number, y: number, width = 100): PdfTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width, hasEOL: false });
  const glyphBullet = (text: string, y: number) => [item("•", 50, y, 3), item(" ", 53, y, 7), item(text, 61, y)];

  it("a continuation at the bullet text's x joins; the next bullet stays separate", () => {
    const text = assemblePdfPages([[...glyphBullet("Reduced churn from 9% to", 700), item("6.5% in two quarters.", 61, 686), ...glyphBullet("Led a team of 4.", 672)]]);
    expect(text.split("\n").filter(Boolean)).toEqual(["• Reduced churn from 9% to 6.5% in two quarters.", "• Led a team of 4."]);
  });

  it("three-line bullets join in order; punctuation is kept as written", () => {
    const text = assemblePdfPages([[...glyphBullet("Shipped v2.0 (beta),", 700), item("then GA: 3 cities;", 61, 686), item("NPS +18.", 61, 672)]]);
    expect(text.split("\n").filter(Boolean)).toEqual(["• Shipped v2.0 (beta), then GA: 3 cities; NPS +18."]);
  });

  it("a bullet that continues on the next page joins across the page break", () => {
    const text = assemblePdfPages([[...glyphBullet("Migrated 120 services to", 60)], [item("Kubernetes in 5 months.", 61, 780)]]);
    expect(text.split("\n").filter(Boolean)).toEqual(["• Migrated 120 services to Kubernetes in 5 months."]);
  });

  it("third-party layouts are not merged: a paragraph at the margin, another indent, a heading, a column row", () => {
    const lines = assemblePdfPages([[
      ...glyphBullet("Built the billing service", 700),
      item("Plain paragraph at the margin.", 50, 686),
      ...glyphBullet("Second bullet", 672),
      item("Deeper sub-point", 75, 658),
      ...glyphBullet("Third bullet", 644),
      item("SKILLS", 50, 620),
      ...glyphBullet("Fourth bullet", 600),
      item("Acme", 61, 586, 30), item(" ", 91, 586, 400), item("Pune", 500, 586, 25),
    ]]).split("\n").filter(Boolean);
    expect(lines).toEqual([
      "• Built the billing service", "Plain paragraph at the margin.",
      "• Second bullet", "Deeper sub-point",
      "• Third bullet", "SKILLS",
      "• Fourth bullet", "Acme\tPune",
    ]);
  });

  it("a bullet whose glyph shares the text item (no measurable text x) is never joined", () => {
    const lines = assemblePdfPages([[item("• Owned the roadmap", 50, 700), item("for payments.", 58, 686)]]).split("\n").filter(Boolean);
    expect(lines).toEqual(["• Owned the roadmap", "for payments."]);
  });

  it("a third-party PDF (pdf-lib, dash bullets, text at the margin) parses as before through real pdf.js", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const rows: [string, number][] = [
      ["Meera Pillai", 50], ["meera.pillai@example.com | +91 98450 11111 | Pune", 50], ["EXPERIENCE", 50],
      ["Data Analyst, Acme Analytics", 50], ["Jan 2023 - Present", 50],
      ["- Built 14 dashboards in Power BI for the sales team", 50], ["- Cut report time by 60%", 50],
      ["EDUCATION", 50], ["B.Sc Statistics, 2022", 50], ["Fergusson College", 50],
    ];
    rows.forEach(([t, x], k) => page.drawText(t, { x, y: 740 - k * 16, size: 10, font }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "third-party-"));
    const file = path.join(dir, "third-party.pdf");
    fs.writeFileSync(file, await doc.save());
    const [pdfPages] = pdfItems([file]);
    fs.rmSync(dir, { recursive: true, force: true });
    const text = assemblePdfPages(pdfPages);
    expect(text).not.toMatch(/\t/);
    const p = extractProfile(text);
    // Identical to what the single-space join (main's route) gave for this file.
    const legacy = extractProfile(pdfPages.map(legacyRouteJoin).join("\n"));
    expect(p).toEqual(legacy);
    expect(p.experience.flatMap((e) => e.bullets)).toEqual(["Built 14 dashboards in Power BI for the sales team", "Cut report time by 60%"]);
  });
});

describe("project tech rows (the app's \" · \" row) vs a genuine next project title", () => {
  it("the production shape: title, tech row, sentence bullets -> one project", () => {
    expect(parseProjectsBlock([
      "CampusEats - Canteen Pre-order App",
      "React Native · Firebase · Node.js · Figma",
      "• Final-year capstone.",
      "• Owned the product spec and ran the pilot with two canteens.",
    ])).toEqual([{
      name: "CampusEats - Canteen Pre-order App",
      description: "Final-year capstone. Owned the product spec and ran the pilot with two canteens.",
      tech: ["React Native", "Firebase", "Node.js", "Figma"],
    }]);
  });

  it("a single known tech before the bullets is the tech row", () => {
    expect(parseProjectsBlock(["Sales Dashboard", "Tableau", "• Built a weekly sales dashboard."])).toEqual([
      { name: "Sales Dashboard", description: "Built a weekly sales dashboard.", tech: ["Tableau"] },
    ]);
  });

  it("a genuine next project title after a project with no description stays a project", () => {
    expect(parseProjectsBlock(["Campus Bus Tracker", "Lecture Notes Search", "• Indexed shared notes."]).map((x) => x.name))
      .toEqual(["Campus Bus Tracker", "Lecture Notes Search"]);
    // " · " in a title with no known tech, and a lone tech word with no bullet after it.
    expect(parseProjectsBlock(["Portfolio", "Photo Journal · Travel Blog", "• Wrote 40 posts."]).map((x) => x.name))
      .toEqual(["Portfolio", "Photo Journal · Travel Blog"]);
    expect(parseProjectsBlock(["Hackathon Entry", "Python"]).map((x) => x.name)).toEqual(["Hackathon Entry", "Python"]);
  });

  it("a tech row is only read right after a title, never after the description started", () => {
    const out = parseProjectsBlock(["Expense Splitter", "• Split shared trip costs.", "Budget Planner", "React · Node.js", "• Tracks monthly spend."]);
    expect(out).toEqual([
      { name: "Expense Splitter", description: "Split shared trip costs.", tech: [] },
      { name: "Budget Planner", description: "Tracks monthly spend.", tech: ["React", "Node.js"] },
    ]);
  });

  it("third-party project layouts parse as before", () => {
    expect(parseProjectsBlock(["Chat App", "Tech: React, Socket.io, Redis", "Built a realtime chat for 500 users."])).toEqual([
      { name: "Chat App", description: "Built a realtime chat for 500 users.", tech: ["React", "Socket.io", "Redis"] },
    ]);
    // A comma list after a title is not the app's row: unchanged (read as a title, as before).
    expect(parseProjectsBlock(["Chat App", "React, Node.js"]).map((x) => x.name)).toEqual(["Chat App", "React, Node.js"]);
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
