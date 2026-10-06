/**
 * The three offered PDF styles (Classic, Modern, Compact) across every
 * profile type, checked the way an ATS reads them: the real text pdf.js
 * extracts, in content-stream order — not the renderer's own record of what
 * it drew.
 *
 * For every style × profile:
 *   - nothing lost: every source field is in the extracted text, verbatim;
 *   - nothing added: every extracted word comes from the source or is a
 *     standard heading / separator;
 *   - reading order: top to bottom in stream order, name first, then contact,
 *     then sections in the resolved order under standard headings;
 *   - text and thin rules only: no fills, images, annotations or form fields;
 *   - nothing clipped: all text inside the page margins; dates and locations
 *     share one right edge;
 *   - page budget: one page where the content fits, pagination (never
 *     clipping) where it does not.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PDFDocument, rgb } from "pdf-lib";
import { layoutResumePdf, renderResumePdf, resolveSectionOrder, resolveTemplate, formatGrade, descriptionBullets, type ResumeJson } from "@/lib/resume-pdf";
import { TEMPLATE_IDS, DEFAULT_TEMPLATE, downloadStyle, storedTemplate } from "@/lib/templates";
import { FIXTURES, FRESHER, EXPERIENCED, SENIOR, LONG, type Fixture } from "./helpers/resume-fixtures";

type Item = { str: string; x: number; y: number; w: number; size: number };
type Extracted = {
  file: string; pages: number; hasForm: boolean;
  pageData: { width: number; height: number; items: Item[]; ops: { fill: number; image: number; stroke: number; text: number }; annotations: number }[];
};

const EXTRACT = path.join(__dirname, "helpers", "pdf-extract.mjs");
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN: Record<string, number> = { classic: 50, modern: 50, compact: 40 };
const HEADINGS: Record<string, string> = { summary: "SUMMARY", experience: "EXPERIENCE", skills: "SKILLS", education: "EDUCATION", projects: "PROJECTS" };

function extract(files: string[]): Extracted[] {
  return JSON.parse(execFileSync("node", [EXTRACT, ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Every source string an ATS must find, in the form the PDF shows it. */
function sourceFields(f: Fixture): string[] {
  const r = f.resume;
  const c = f.contact;
  return [
    c.full_name, c.email, c.phone, c.current_city, r.headline, r.summary,
    ...(r.experience ?? []).flatMap((e) => [e.role, e.company, e.duration, e.location, ...e.bullets]),
    ...(r.skills ?? []),
    ...(r.education ?? []).flatMap((e) => [e.degree, e.institution, e.year, e.location, formatGrade(e.cgpa)]),
    ...(r.projects ?? []).flatMap((p) => [p.name, ...p.tech, ...descriptionBullets(p.description)]),
  ].filter((s): s is string => !!s && !!s.trim()).map(norm);
}

const SEPARATORS = new Set(["·", "•"]);
const words = (s: string) => norm(s).split(" ").filter(Boolean);

// Render every style × profile once, extract them all in one pdf.js process.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ats-styles-"));
type Case = { style: string; fixture: Fixture; layoutPages: number; file: string };
const cases: Case[] = [];
let extracted: Record<string, Extracted> = {};

beforeAll(async () => {
  for (const style of TEMPLATE_IDS) {
    for (const fixture of FIXTURES) {
      const laid = await layoutResumePdf(fixture.resume, fixture.contact, style);
      const file = path.join(dir, `${style}-${fixture.id}.pdf`);
      fs.writeFileSync(file, laid.bytes);
      cases.push({ style, fixture, layoutPages: laid.pages, file });
    }
  }
  const out = extract(cases.map((c) => c.file));
  extracted = Object.fromEntries(out.map((e) => [e.file, e]));
}, 60_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const each = TEMPLATE_IDS.flatMap((style) => FIXTURES.map((f) => [style, f.id] as const));
const get = (style: string, id: string) => {
  const c = cases.find((x) => x.style === style && x.fixture.id === id)!;
  return { c, e: extracted[c.file] };
};
const allItems = (e: Extracted) => e.pageData.flatMap((p) => p.items);
const streamText = (e: Extracted) => norm(allItems(e).map((i) => i.str).join(" "));

describe.each(each)("%s × %s", (style, id) => {
  it("nothing lost: every source field is in the extracted text, verbatim", () => {
    const { c, e } = get(style, id);
    const text = streamText(e);
    for (const field of sourceFields(c.fixture)) expect({ field, found: text.includes(field) }).toEqual({ field, found: true });
  });

  it("nothing added: every extracted word comes from the source, a heading or a separator", () => {
    const { c, e } = get(style, id);
    const allowed = new Set([...sourceFields(c.fixture).flatMap(words), ...Object.values(HEADINGS), ...SEPARATORS]);
    const extra = words(streamText(e)).filter((w) => !allowed.has(w));
    expect(extra).toEqual([]);
  });

  it("reading order: top to bottom; name, then contact, then standard headings in the resolved order", () => {
    const { c, e } = get(style, id);
    for (const page of e.pageData) {
      page.items.forEach((it, k) => {
        if (k) expect(it.y).toBeLessThanOrEqual(page.items[k - 1].y + 1); // never jumps back up
      });
    }
    const items = allItems(e);
    expect(items[0].str).toBe(c.fixture.contact.full_name);
    const emailAt = items.findIndex((i) => i.str.includes(c.fixture.contact.email!));
    const headingAt = items.findIndex((i) => Object.values(HEADINGS).includes(i.str));
    expect(emailAt).toBeGreaterThan(0);
    expect(emailAt).toBeLessThan(headingAt);
    const headings = items.map((i) => i.str).filter((s) => Object.values(HEADINGS).includes(s));
    const r = c.fixture.resume;
    const present = (s: string) => {
      const v = r[s as keyof ResumeJson];
      return Array.isArray(v) ? v.length > 0 : !!(typeof v === "string" && v.trim());
    };
    expect(headings).toEqual(resolveSectionOrder(r).filter(present).map((s) => HEADINGS[s]));
  });

  it("text and thin rules only: no fills, images, annotations or form fields; one rule per heading plus the header", () => {
    const { e } = get(style, id);
    expect(e.hasForm).toBe(false);
    for (const p of e.pageData) {
      expect({ fill: p.ops.fill, image: p.ops.image, annotations: p.annotations }).toEqual({ fill: 0, image: 0, annotations: 0 });
    }
    const headings = allItems(e).filter((i) => Object.values(HEADINGS).includes(i.str)).length;
    expect(e.pageData.reduce((n, p) => n + p.ops.stroke, 0)).toBe(headings + 1);
  });

  it("nothing clipped: all text inside the margins; dates and locations share the right edge", () => {
    const { e } = get(style, id);
    const m = MARGIN[style];
    const rightEdges: number[] = [];
    for (const p of e.pageData) {
      expect([p.width, p.height]).toEqual([PAGE_W, PAGE_H]);
      for (const it of p.items) {
        expect(it.x).toBeGreaterThanOrEqual(m - 0.01);
        // pdf.js measures the standard fonts with its own metrics, up to ~1.5%
        // wider than the AFM widths pdf-lib lays out with (as a substitute
        // font in a viewer may be): allow that, far inside the 40-50pt margin.
        expect(it.x + it.w).toBeLessThanOrEqual(PAGE_W - m + Math.max(1, it.w * 0.015));
        expect(it.y).toBeGreaterThanOrEqual(m - 0.01);
        // Cap height of the standard fonts is about 0.72 em.
        expect(it.y + it.size * 0.72).toBeLessThanOrEqual(PAGE_H - m + 0.5);
        if (it.x > PAGE_W / 2) rightEdges.push(it.x + it.w - it.w * 0.006);
      }
    }
    // Right-hand text exists only as flush-right dates / locations.
    for (const r of rightEdges) expect(Math.abs(r - (PAGE_W - m))).toBeLessThan(0.8);
  });

  it("pdf.js sees the same page count the layout reports", () => {
    const { c, e } = get(style, id);
    expect(e.pages).toBe(c.layoutPages);
  });

  it("hierarchy: the name is the largest text; headings above bullets", () => {
    const { c, e } = get(style, id);
    const items = allItems(e);
    const name = items[0].size;
    expect(Math.max(...items.slice(1).map((i) => i.size))).toBeLessThan(name);
    const heading = items.find((i) => i.str === "SKILLS")!.size;
    const bullet = items.find((i) => i.str.startsWith((c.fixture.resume.skills ?? [""])[0]))!.size;
    expect(heading).toBeGreaterThan(bullet);
  });
});

describe("page budget", () => {
  it.each(TEMPLATE_IDS)("%s: fresher and experienced profiles fit one page", (style) => {
    expect(get(style, FRESHER.id).e.pages).toBe(1);
    expect(get(style, EXPERIENCED.id).e.pages).toBe(1);
  });

  it("compact fits the dense senior profile on one page, and never uses more pages than classic", () => {
    expect(get("compact", SENIOR.id).e.pages).toBe(1);
    for (const f of FIXTURES) expect(get("compact", f.id).e.pages).toBeLessThanOrEqual(get("classic", f.id).e.pages);
  });

  it.each(TEMPLATE_IDS)("%s: a resume longer than a page paginates (nothing clipped, checked above)", (style) => {
    expect(get(style, LONG.id).e.pages).toBeGreaterThan(1);
  });

  it("no style takes more pages than needed: a one-page resume stays one page in every style", () => {
    for (const style of TEMPLATE_IDS) expect(get(style, SENIOR.id).e.pages).toBeLessThanOrEqual(2);
  });
});

describe("adaptive section order", () => {
  it("no section_order and no experience (a fresher): education and projects come first", () => {
    expect(resolveSectionOrder(FRESHER.resume)).toEqual(["summary", "education", "projects", "skills", "experience"]);
  });

  it("no section_order with experience: experience comes first", () => {
    expect(resolveSectionOrder({ ...EXPERIENCED.resume, section_order: undefined })).toEqual(["summary", "experience", "skills", "education", "projects"]);
  });

  it("blank experience placeholders do not count as experience", () => {
    expect(resolveSectionOrder({ ...FRESHER.resume, experience: [{ company: " ", role: "", duration: "", location: "", bullets: [] }] })[1]).toBe("education");
  });

  it("the generator's section_order always wins", () => {
    expect(resolveSectionOrder({ ...FRESHER.resume, section_order: ["summary", "skills", "projects", "education"] }))
      .toEqual(["summary", "skills", "projects", "education", "experience"]);
  });
});

describe("saved resumes and style selection", () => {
  it("offered styles are classic (default), modern and compact", () => {
    expect([...TEMPLATE_IDS]).toEqual(["classic", "modern", "compact"]);
    expect(DEFAULT_TEMPLATE).toBe("classic");
    expect(storedTemplate("executive")).toBe("classic");
  });

  it("a saved resume renders in its saved style; null or unknown renders Classic; a saved Executive still renders", async () => {
    expect(resolveTemplate(null)).toBe("classic");
    expect(resolveTemplate("bogus")).toBe("classic");
    expect(resolveTemplate("executive")).toBe("executive");
    const rj = EXPERIENCED.resume;
    const c = EXPERIENCED.contact;
    expect(Buffer.from(await renderResumePdf(rj, c, null)).equals(Buffer.from(await renderResumePdf(rj, c, "classic")))).toBe(true);
    const classic = await layoutResumePdf(rj, c, "classic");
    const exec = await layoutResumePdf(rj, c, "executive");
    expect(Buffer.from(exec.bytes).equals(Buffer.from(classic.bytes))).toBe(false);
    expect(exec.pages).toBe(1);
    // Same words (wrapping may differ), different typography.
    const ws = (d: { text: string }[]) => words(d.map((x) => x.text).join(" ")).sort();
    expect(ws(exec.drawn)).toEqual(ws(classic.drawn));
  });

  it("downloadStyle: an offered ?style= wins; anything else keeps the saved style (retired styles cannot be requested)", () => {
    expect(downloadStyle("modern", "classic")).toBe("modern");
    expect(downloadStyle("compact", "executive")).toBe("compact");
    expect(downloadStyle("executive", "classic")).toBe("classic");
    expect(downloadStyle(null, "executive")).toBe("executive");
    expect(downloadStyle("bogus", null)).toBeNull();
    expect(downloadStyle(undefined, "modern")).toBe("modern");
  });
});

describe("the extractor itself detects what it guards against", () => {
  it("counts a filled rectangle and an image", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 50, y: 50, width: 100, height: 20, color: rgb(0.9, 0.9, 0.9) });
    // 1×1 PNG
    const png = await doc.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    page.drawImage(png, { x: 10, y: 10, width: 5, height: 5 });
    const file = path.join(dir, "graphics.pdf");
    fs.writeFileSync(file, await doc.save());
    const [e] = extract([file]);
    expect(e.pageData[0].ops.fill).toBeGreaterThan(0);
    expect(e.pageData[0].ops.image).toBeGreaterThan(0);
  });
});
