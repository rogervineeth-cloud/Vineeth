// Resume PDF layout.
//
// Design constraints, in priority order:
//
//  1. ATS-parseable above all else. Real parsers (Workday, Greenhouse, Lever,
//     Naukri RMS, Taleo) read a linear text stream. That means SINGLE COLUMN
//     for every template, standard fonts, no tables, no text inside graphics,
//     and standard section headings. Templates vary typography and accent
//     only — never structure. A genuinely two-column "modern" template would
//     look nicer and parse worse, which is the opposite of what this product
//     sells.
//
//  2. Never silently lose content. The previous renderer created exactly one
//     page and drew past the bottom margin when a resume ran long, so text
//     simply vanished off the sheet. It now starts a new page instead.
//
//  3. Honour the section order the generator chose. The system prompt asks for
//     a fresher ordering (education and projects before experience) versus an
//     experienced ordering, and returns it as `section_order` — which the
//     renderer used to ignore in favour of a hardcoded sequence, so freshers
//     got an experienced person's layout.
//
//  4. One visual hierarchy in every template: name > headline > contact >
//     section heading > entry title (bold) > entry meta (dates, employer,
//     institution, tech) > body and bullets. Templates change typeface,
//     accent, margins and density only.
//
//  5. A sparse page should look deliberate, not unfinished. The page is laid
//     out once, measured, and — if it fills little of the sheet — laid out
//     again with more generous spacing and slightly larger type; a page that
//     spills a few lines onto a second sheet is tightened instead. Nothing is
//     ever added to fill space.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type Color } from "pdf-lib";
import { formatGrade, descriptionBullets } from "@/lib/resume-format";

export { formatGrade, descriptionBullets };

export type TemplateId = "classic" | "modern" | "compact" | "executive";

export type ResumeJson = {
  /** Fact-bounded line under the name (lib/resume-generation buildHeadline). */
  headline?: string;
  summary?: string;
  experience?: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills?: string[];
  // Only "cgpa", which the sanitiser restores from the profile. A stored
  // "gpa" came straight from the model, unverified, and is never drawn.
  education?: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  projects?: Array<{ name: string; description: string; tech: string[] }>;
  section_order?: string[];
  tailored_role?: string;
};

export type ContactDetails = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  current_city?: string | null;
};

// A4
const PAGE_W = 595;
const PAGE_H = 842;

const GREEN = rgb(0.122, 0.361, 0.227); // #1f5c3a
const BLACK = rgb(0.102, 0.102, 0.102); // #1a1a1a
const GREY = rgb(0.42, 0.42, 0.42);
const DIM = rgb(0.27, 0.27, 0.27);
const SUBTLE = rgb(0.82, 0.84, 0.87);

type Theme = {
  margin: number;
  nameSize: number;
  contactSize: number;
  sectionSize: number;
  bodySize: number;
  bulletSize: number;
  lineTight: number;   // multiplier for body line height
  entryGap: number;    // vertical gap after each entry
  sectionGap: number;  // vertical gap before each section heading
  serif: boolean;
  accent: Color;
  nameColor: Color;
  /** Solid rule under the name block. */
  headerRule: boolean;
  /** Filled accent bar to the left of each section heading. */
  sectionBar: boolean;
  uppercaseSections: boolean;
};

// Section headings are always a step above body text (bold, accent,
// uppercase); entry titles are body size in bold; meta is a step below.
const THEMES: Record<TemplateId, Theme> = {
  classic: {
    margin: 50, nameSize: 20, contactSize: 9, sectionSize: 10.5, bodySize: 10, bulletSize: 9.5,
    lineTight: 1.4, entryGap: 5, sectionGap: 9, serif: false, accent: GREEN, nameColor: BLACK,
    headerRule: true, sectionBar: false, uppercaseSections: true,
  },
  // Denser: smaller type and tighter leading to fit more on one sheet.
  compact: {
    margin: 42, nameSize: 17, contactSize: 8.5, sectionSize: 9.5, bodySize: 9, bulletSize: 8.75,
    lineTight: 1.3, entryGap: 3, sectionGap: 7, serif: false, accent: GREEN, nameColor: BLACK,
    headerRule: true, sectionBar: false, uppercaseSections: true,
  },
  // Roomier, serif, larger name. Still single column.
  executive: {
    margin: 54, nameSize: 23, contactSize: 9.5, sectionSize: 11, bodySize: 10.5, bulletSize: 10,
    lineTight: 1.45, entryGap: 6, sectionGap: 10, serif: true, accent: BLACK, nameColor: BLACK,
    headerRule: true, sectionBar: false, uppercaseSections: true,
  },
  // Accent-forward: green name and a filled bar beside each heading.
  modern: {
    margin: 50, nameSize: 22, contactSize: 9, sectionSize: 10.5, bodySize: 10, bulletSize: 9.5,
    lineTight: 1.4, entryGap: 5, sectionGap: 9, serif: false, accent: GREEN, nameColor: GREEN,
    headerRule: false, sectionBar: true, uppercaseSections: true,
  },
};

export function resolveTemplate(id: string | null | undefined): TemplateId {
  return id === "modern" || id === "compact" || id === "executive" ? id : "classic";
}

/** How much the measured fit pass loosens (>1) or tightens (<1) the layout. */
type Fit = { space: number; font: number; sectionExtra?: number };
const NATURAL: Fit = { space: 1, font: 0 };

/** One drawn string, recorded for layout tests. */
export type DrawnText = {
  page: number;
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  role: "name" | "headline" | "contact" | "section" | "title" | "meta" | "body" | "bullet";
};

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  pageIndex: number;
  bold: PDFFont;
  regular: PDFFont;
  theme: Theme;
  fit: Fit;
  y: number;
  contentW: number;
  drawn: DrawnText[];
};

// Sizes after the fit adjustment. Section headings move with the body so they
// stay a step above it; the name keeps its size.
const sectionSize = (c: Ctx) => c.theme.sectionSize + c.fit.font;
const body = (c: Ctx) => c.theme.bodySize + c.fit.font;
const bulletSize = (c: Ctx) => c.theme.bulletSize + c.fit.font;
const metaSize = (c: Ctx) => c.theme.bodySize - 1 + c.fit.font * 0.5;
const lead = (c: Ctx, size: number) => size * c.theme.lineTight * (1 + (c.fit.space - 1) * 0.35);
const gap = (c: Ctx, g: number) => g * c.fit.space;

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word; // overlong single word: emit as-is rather than loop forever
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Make sure `needed` points of vertical space remain; otherwise start a new
 * page. This is what stops long resumes from running off the bottom.
 */
function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed >= ctx.theme.margin) return;
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageIndex++;
  ctx.y = PAGE_H - ctx.theme.margin;
}

function text(
  ctx: Ctx,
  t: string,
  o: { x: number; size: number; bold?: boolean; color: Color; role: DrawnText["role"] }
) {
  const font = o.bold ? ctx.bold : ctx.regular;
  ctx.page.drawText(t, { x: o.x, y: ctx.y, size: o.size, font, color: o.color });
  ctx.drawn.push({ page: ctx.pageIndex, text: t, x: o.x, y: ctx.y, size: o.size, bold: Boolean(o.bold), role: o.role });
}

function drawParagraph(
  ctx: Ctx,
  t: string,
  opts: { size: number; bold?: boolean; color?: Color; x?: number; maxWidth?: number; role?: DrawnText["role"] }
) {
  const font = opts.bold ? ctx.bold : ctx.regular;
  const x = opts.x ?? ctx.theme.margin;
  const maxW = opts.maxWidth ?? ctx.contentW - (x - ctx.theme.margin);
  const lh = lead(ctx, opts.size);
  for (const line of wrapText(t, font, opts.size, maxW)) {
    ensureSpace(ctx, lh);
    text(ctx, line, { x, size: opts.size, bold: opts.bold, color: opts.color ?? BLACK, role: opts.role ?? "body" });
    ctx.y -= lh;
  }
}

function drawSectionHeader(ctx: Ctx, title: string) {
  const t = ctx.theme;
  // Keep the heading with at least its first entry line.
  ensureSpace(ctx, gap(ctx, t.sectionGap) + (ctx.fit.sectionExtra ?? 0) + sectionSize(ctx) + 4 + body(ctx) * 2.5);
  ctx.y -= gap(ctx, t.sectionGap) + (ctx.fit.sectionExtra ?? 0);
  const label = t.uppercaseSections ? title.toUpperCase() : title;
  let textX = t.margin;
  if (t.sectionBar) {
    ctx.page.drawRectangle({ x: t.margin, y: ctx.y - 1.5, width: 3, height: sectionSize(ctx) + 1, color: t.accent });
    textX = t.margin + 8;
  }
  text(ctx, label, { x: textX, size: sectionSize(ctx), bold: true, color: t.accent, role: "section" });
  ctx.y -= 4;
  if (!t.sectionBar) {
    ctx.page.drawLine({
      start: { x: t.margin, y: ctx.y },
      end: { x: t.margin + ctx.contentW, y: ctx.y },
      thickness: 0.5,
      color: t.accent,
    });
  }
  ctx.y -= gap(ctx, 5) + body(ctx) * 0.9;
}

/**
 * An entry's first line: bold title on the left, meta (dates) flush right.
 * When both do not fit on one line, the title wraps and the meta takes the
 * right edge of the line below instead of overprinting it.
 */
function drawTitleRow(ctx: Ctx, title: string, right: string) {
  const size = body(ctx);
  const ms = metaSize(ctx);
  const rightW = right ? ctx.regular.widthOfTextAtSize(right, ms) : 0;
  const room = ctx.contentW - (rightW ? rightW + 12 : 0);
  const lines = wrapText(title, ctx.bold, size, room);
  const lh = lead(ctx, size) * 0.95;
  ensureSpace(ctx, lh * lines.length + lead(ctx, bulletSize(ctx)));
  lines.forEach((line, i) => {
    text(ctx, line, { x: ctx.theme.margin, size, bold: true, color: BLACK, role: "title" });
    if (i === 0 && right) {
      text(ctx, right, { x: ctx.theme.margin + ctx.contentW - rightW, size: ms, color: GREY, role: "meta" });
    }
    ctx.y -= lh;
  });
}

/** The line under an entry title: employer, institution, tech. */
function drawMetaRow(ctx: Ctx, meta: string, color: Color = DIM) {
  if (!meta.trim()) return;
  drawParagraph(ctx, meta, { size: metaSize(ctx) + 0.5, color, role: "meta" });
  ctx.y -= gap(ctx, 1);
}

function drawBullets(ctx: Ctx, bullets: string[]) {
  const size = bulletSize(ctx);
  const lh = lead(ctx, size) * 0.97;
  for (const bullet of bullets) {
    const trimmed = bullet.trim();
    if (!trimmed) continue;
    const lines = wrapText(trimmed, ctx.regular, size, ctx.contentW - 11);
    // Keep the glyph with its first line even if a page break lands here.
    ensureSpace(ctx, lh);
    ctx.page.drawText("·", { x: ctx.theme.margin + 2, y: ctx.y, size, font: ctx.bold, color: ctx.theme.accent });
    for (const line of lines) {
      ensureSpace(ctx, lh);
      text(ctx, line, { x: ctx.theme.margin + 11, size, color: BLACK, role: "bullet" });
      ctx.y -= lh;
    }
    ctx.y -= gap(ctx, 1);
  }
}

const join = (...parts: Array<string | undefined | null>) =>
  parts.map((p) => (p ?? "").trim()).filter(Boolean).join("  ·  ");

// ── Sections ───────────────────────────────────────────────────────────────

function renderSummary(ctx: Ctx, rj: ResumeJson) {
  if (!rj.summary?.trim()) return;
  drawSectionHeader(ctx, "Summary");
  drawParagraph(ctx, rj.summary.trim(), { size: body(ctx) });
  ctx.y -= gap(ctx, ctx.theme.entryGap) * 0.5;
}

function renderExperience(ctx: Ctx, rj: ResumeJson) {
  if (!rj.experience?.length) return;
  drawSectionHeader(ctx, "Experience");
  for (const exp of rj.experience) {
    drawTitleRow(ctx, exp.role || exp.company, exp.duration ?? "");
    drawMetaRow(ctx, join(exp.role ? exp.company : "", exp.location));
    drawBullets(ctx, exp.bullets ?? []);
    ctx.y -= gap(ctx, ctx.theme.entryGap);
  }
}

function renderSkills(ctx: Ctx, rj: ResumeJson) {
  if (!rj.skills?.length) return;
  drawSectionHeader(ctx, "Skills");
  drawParagraph(ctx, rj.skills.join("  ·  "), { size: bulletSize(ctx) });
  ctx.y -= gap(ctx, ctx.theme.entryGap) * 0.5;
}

function renderEducation(ctx: Ctx, rj: ResumeJson) {
  if (!rj.education?.length) return;
  drawSectionHeader(ctx, "Education");
  for (const edu of rj.education) {
    drawTitleRow(ctx, edu.degree?.trim() || edu.institution, edu.year ?? "");
    drawMetaRow(ctx, join(edu.degree?.trim() ? edu.institution : "", edu.location, formatGrade(edu.cgpa)));
    ctx.y -= gap(ctx, ctx.theme.entryGap);
  }
}

function renderProjects(ctx: Ctx, rj: ResumeJson) {
  if (!rj.projects?.length) return;
  drawSectionHeader(ctx, "Projects");
  for (const proj of rj.projects) {
    drawTitleRow(ctx, proj.name, "");
    if (proj.tech?.length) drawMetaRow(ctx, proj.tech.join("  ·  "), ctx.theme.accent);
    drawBullets(ctx, descriptionBullets(proj.description ?? ""));
    ctx.y -= gap(ctx, ctx.theme.entryGap);
  }
}

const RENDERERS: Record<string, (ctx: Ctx, rj: ResumeJson) => void> = {
  summary: renderSummary,
  experience: renderExperience,
  skills: renderSkills,
  education: renderEducation,
  projects: renderProjects,
};

/** Fallback when the generator gives no usable section_order. */
const DEFAULT_ORDER = ["summary", "experience", "skills", "education", "projects"];

/**
 * The order to render in: whatever the generator asked for, plus any section
 * it forgot to mention (so a section can never be silently dropped just
 * because it is missing from section_order).
 */
export function resolveSectionOrder(rj: ResumeJson): string[] {
  const seen = new Set<string>();
  const requested: string[] = [];
  for (const s of rj.section_order ?? []) {
    // Dedupe: a repeated name in section_order would otherwise render that
    // whole section twice in the finished PDF.
    if (s in RENDERERS && !seen.has(s)) {
      seen.add(s);
      requested.push(s);
    }
  }
  return [...requested, ...DEFAULT_ORDER.filter((s) => !seen.has(s))];
}

type Laid = { doc: PDFDocument; pages: number; fill: number; drawn: DrawnText[]; fit: Fit; sections: number };

async function layOut(rj: ResumeJson, contact: ContactDetails, theme: Theme, fit: Fit): Promise<Laid> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(theme.serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(theme.serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    doc, page, pageIndex: 0, bold, regular, theme, fit,
    y: PAGE_H - theme.margin - theme.nameSize * 0.75,
    contentW: PAGE_W - theme.margin * 2,
    drawn: [],
  };

  // ── Header ───────────────────────────────────────────────────────────────
  const name = contact.full_name?.trim() || "Candidate";
  text(ctx, name, { x: theme.margin, size: theme.nameSize, bold: true, color: theme.nameColor, role: "name" });
  ctx.y -= theme.nameSize * 0.45 + 8;

  const headline = rj.headline?.trim();
  if (headline) {
    drawParagraph(ctx, headline, { size: theme.bodySize + 1, color: DIM, role: "headline" });
    ctx.y += lead(ctx, theme.bodySize + 1) - (theme.bodySize + 1) - 4;
  }

  const contactLine = [contact.email, contact.phone, contact.current_city]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join("  ·  ");
  if (contactLine) {
    drawParagraph(ctx, contactLine, { size: theme.contactSize, color: GREY, role: "contact" });
    ctx.y += lead(ctx, theme.contactSize) - theme.contactSize - 2;
  }
  ctx.y -= 4;

  if (theme.headerRule) {
    ctx.page.drawLine({
      start: { x: theme.margin, y: ctx.y },
      end: { x: theme.margin + ctx.contentW, y: ctx.y },
      thickness: 0.5,
      color: SUBTLE,
    });
  }
  ctx.y -= 2;

  // ── Body, in the generator's chosen order ────────────────────────────────
  let sections = 0;
  for (const section of resolveSectionOrder(rj)) {
    const before = ctx.drawn.length;
    RENDERERS[section]?.(ctx, rj);
    if (ctx.drawn.length > before) sections++;
  }

  const usable = PAGE_H - theme.margin * 2;
  const usedOnLast = PAGE_H - theme.margin - ctx.y;
  return { doc, pages: ctx.pageIndex + 1, fill: Math.min(1, usedOnLast / usable), drawn: ctx.drawn, fit, sections };
}

/** Loosen a page this sparse; aim to fill about this much of it. */
/** At most this much extra space before each section heading, in points. */
const MAX_SECTION_EXTRA = 12;
const SPARSE_BELOW = 0.8;
const FILL_TARGET = 0.93;
const LOOSEN: Fit[] = [1.45, 1.38, 1.31, 1.25, 1.19, 1.13, 1.07].map((s) => ({ space: s, font: Math.min(1, (s - 1) * 2.5) }));
const TIGHTEN: Fit[] = [
  { space: 0.9, font: -0.25 },
  { space: 0.8, font: -0.5 },
];

/**
 * Lay the resume out at its natural spacing, then fit it to the page: a
 * sparse one-page resume takes the loosest spacing that still fits on one
 * page; one that spills onto a second page takes the first tightening that
 * brings it back to one. Anything else keeps its natural layout.
 */
export async function layoutResumePdf(
  rj: ResumeJson,
  contact: ContactDetails,
  templateId: string | null | undefined
): Promise<{ bytes: Uint8Array; pages: number; fill: number; drawn: DrawnText[]; fit: Fit }> {
  const theme = THEMES[resolveTemplate(templateId)];
  let chosen = await layOut(rj, contact, theme, NATURAL);
  if (chosen.pages === 1 && chosen.fill < SPARSE_BELOW) {
    for (const fit of LOOSEN) {
      const l = await layOut(rj, contact, theme, fit);
      if (l.pages === 1 && l.fill <= FILL_TARGET) {
        chosen = l;
        break;
      }
    }
    // Still short of the target even at the loosest spacing: share what is
    // left between the section breaks (capped), so the sections sit evenly
    // down the page instead of stopping two-thirds of the way.
    if (chosen.pages === 1 && chosen.fill < FILL_TARGET - 0.02 && chosen.sections > 1) {
      const leftover = (FILL_TARGET - chosen.fill) * (PAGE_H - theme.margin * 2);
      const extra = Math.min(MAX_SECTION_EXTRA, leftover / chosen.sections);
      const l = await layOut(rj, contact, theme, { ...chosen.fit, sectionExtra: extra });
      if (l.pages === 1) chosen = l;
    }
  } else if (chosen.pages === 2) {
    for (const fit of TIGHTEN) {
      const l = await layOut(rj, contact, theme, fit);
      if (l.pages === 1) {
        chosen = l;
        break;
      }
    }
  }
  const bytes = await chosen.doc.save();
  return { bytes, pages: chosen.pages, fill: chosen.fill, drawn: chosen.drawn, fit: chosen.fit };
}

export async function renderResumePdf(
  rj: ResumeJson,
  contact: ContactDetails,
  templateId: string | null | undefined
): Promise<Uint8Array> {
  return (await layoutResumePdf(rj, contact, templateId)).bytes;
}
