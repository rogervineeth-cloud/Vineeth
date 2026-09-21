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

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type Color } from "pdf-lib";

export type TemplateId = "classic" | "modern" | "compact" | "executive";

export type ResumeJson = {
  summary?: string;
  experience?: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills?: string[];
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
  serif: boolean;
  accent: Color;
  nameColor: Color;
  /** Solid rule under the name block. */
  headerRule: boolean;
  /** Filled accent bar to the left of each section heading. */
  sectionBar: boolean;
  uppercaseSections: boolean;
};

const THEMES: Record<TemplateId, Theme> = {
  classic: {
    margin: 50, nameSize: 20, contactSize: 9, sectionSize: 8, bodySize: 10, bulletSize: 9.5,
    lineTight: 1.45, entryGap: 4, serif: false, accent: GREEN, nameColor: BLACK,
    headerRule: true, sectionBar: false, uppercaseSections: true,
  },
  // Denser: smaller type and tighter leading to fit more on one sheet.
  compact: {
    margin: 42, nameSize: 17, contactSize: 8.5, sectionSize: 7.5, bodySize: 9, bulletSize: 8.75,
    lineTight: 1.3, entryGap: 2, serif: false, accent: GREEN, nameColor: BLACK,
    headerRule: true, sectionBar: false, uppercaseSections: true,
  },
  // Roomier, serif, larger name. Still single column.
  executive: {
    margin: 58, nameSize: 24, contactSize: 9.5, sectionSize: 9, bodySize: 10.5, bulletSize: 10,
    lineTight: 1.6, entryGap: 7, serif: true, accent: BLACK, nameColor: BLACK,
    headerRule: true, sectionBar: false, uppercaseSections: true,
  },
  // Accent-forward: green name and a filled bar beside each heading.
  modern: {
    margin: 50, nameSize: 22, contactSize: 9, sectionSize: 8.5, bodySize: 10, bulletSize: 9.5,
    lineTight: 1.5, entryGap: 5, serif: false, accent: GREEN, nameColor: GREEN,
    headerRule: false, sectionBar: true, uppercaseSections: true,
  },
};

export function resolveTemplate(id: string | null | undefined): TemplateId {
  return id === "modern" || id === "compact" || id === "executive" ? id : "classic";
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  regular: PDFFont;
  theme: Theme;
  y: number;
  contentW: number;
};

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
  ctx.y = PAGE_H - ctx.theme.margin;
}

function drawParagraph(
  ctx: Ctx,
  text: string,
  opts: { size: number; font?: PDFFont; color?: Color; x?: number; maxWidth?: number; lineHeight?: number }
) {
  const font = opts.font ?? ctx.regular;
  const color = opts.color ?? BLACK;
  const x = opts.x ?? ctx.theme.margin;
  const maxW = opts.maxWidth ?? ctx.contentW;
  const lh = opts.lineHeight ?? opts.size * ctx.theme.lineTight;

  for (const line of wrapText(text, font, opts.size, maxW)) {
    ensureSpace(ctx, lh);
    ctx.page.drawText(line, { x, y: ctx.y, size: opts.size, font, color });
    ctx.y -= lh;
  }
}

function drawSectionHeader(ctx: Ctx, title: string) {
  const t = ctx.theme;
  ensureSpace(ctx, 30);
  ctx.y -= 6;
  if (!t.sectionBar) {
    ctx.page.drawLine({
      start: { x: t.margin, y: ctx.y },
      end: { x: t.margin + ctx.contentW, y: ctx.y },
      thickness: 0.5,
      color: t.accent,
    });
  }
  ctx.y -= 11;
  const label = t.uppercaseSections ? title.toUpperCase() : title;
  let textX = t.margin;
  if (t.sectionBar) {
    ctx.page.drawRectangle({
      x: t.margin, y: ctx.y - 1, width: 3, height: t.sectionSize + 2, color: t.accent,
    });
    textX = t.margin + 8;
  }
  ctx.page.drawText(label, { x: textX, y: ctx.y, size: t.sectionSize, font: ctx.bold, color: t.accent });
  ctx.y -= 10;
}

/** Bold label on the left, grey meta flush right, on one line. */
function drawSplitRow(ctx: Ctx, left: string, right: string, size: number) {
  ensureSpace(ctx, size + 6);
  const t = ctx.theme;
  ctx.page.drawText(left, { x: t.margin, y: ctx.y, size, font: ctx.bold, color: BLACK });
  if (right) {
    const w = ctx.regular.widthOfTextAtSize(right, size - 1);
    ctx.page.drawText(right, {
      x: t.margin + ctx.contentW - w, y: ctx.y, size: size - 1, font: ctx.regular, color: GREY,
    });
  }
  ctx.y -= size + 4;
}

// ── Sections ───────────────────────────────────────────────────────────────

function renderSummary(ctx: Ctx, rj: ResumeJson) {
  if (!rj.summary?.trim()) return;
  drawSectionHeader(ctx, "Summary");
  drawParagraph(ctx, rj.summary, { size: ctx.theme.bodySize, lineHeight: ctx.theme.bodySize * 1.5 });
  ctx.y -= ctx.theme.entryGap;
}

function renderExperience(ctx: Ctx, rj: ResumeJson) {
  if (!rj.experience?.length) return;
  drawSectionHeader(ctx, "Experience");
  for (const exp of rj.experience) {
    drawSplitRow(
      ctx,
      `${exp.company} — ${exp.role}`,
      `${exp.duration}${exp.location ? "  ·  " + exp.location : ""}`,
      ctx.theme.bodySize
    );
    for (const bullet of exp.bullets ?? []) {
      const trimmed = bullet.trim();
      if (!trimmed) continue;
      const size = ctx.theme.bulletSize;
      const lh = size * 1.37;
      const lines = wrapText(trimmed, ctx.regular, size, ctx.contentW - 10);
      // Keep the glyph with its first line even if a page break lands here.
      ensureSpace(ctx, lh);
      ctx.page.drawText("·", { x: ctx.theme.margin + 2, y: ctx.y, size, font: ctx.bold, color: ctx.theme.accent });
      for (const line of lines) {
        ensureSpace(ctx, lh);
        ctx.page.drawText(line, { x: ctx.theme.margin + 10, y: ctx.y, size, font: ctx.regular, color: BLACK });
        ctx.y -= lh;
      }
    }
    ctx.y -= ctx.theme.entryGap;
  }
}

function renderSkills(ctx: Ctx, rj: ResumeJson) {
  if (!rj.skills?.length) return;
  drawSectionHeader(ctx, "Skills");
  drawParagraph(ctx, rj.skills.join("  ·  "), { size: ctx.theme.bulletSize, lineHeight: ctx.theme.bulletSize * 1.45 });
  ctx.y -= ctx.theme.entryGap;
}

function renderEducation(ctx: Ctx, rj: ResumeJson) {
  if (!rj.education?.length) return;
  drawSectionHeader(ctx, "Education");
  for (const edu of rj.education) {
    drawSplitRow(
      ctx,
      edu.institution,
      `${edu.year}${edu.location ? "  ·  " + edu.location : ""}`,
      ctx.theme.bodySize
    );
    const degreeLine = edu.degree + (edu.cgpa ? `  ·  ${edu.cgpa}` : "");
    if (degreeLine.trim()) {
      drawParagraph(ctx, degreeLine, { size: ctx.theme.bodySize - 1, color: GREY });
    }
    ctx.y -= ctx.theme.entryGap;
  }
}

function renderProjects(ctx: Ctx, rj: ResumeJson) {
  if (!rj.projects?.length) return;
  drawSectionHeader(ctx, "Projects");
  for (const proj of rj.projects) {
    ensureSpace(ctx, ctx.theme.bodySize + 6);
    ctx.page.drawText(proj.name, {
      x: ctx.theme.margin, y: ctx.y, size: ctx.theme.bodySize, font: ctx.bold, color: BLACK,
    });
    ctx.y -= ctx.theme.bodySize + 3;
    if (proj.description?.trim()) {
      drawParagraph(ctx, proj.description, { size: ctx.theme.bulletSize, color: rgb(0.33, 0.33, 0.33) });
    }
    if (proj.tech?.length) {
      const size = ctx.theme.bulletSize - 1;
      ensureSpace(ctx, size + 6);
      ctx.page.drawText(proj.tech.join("  ·  "), {
        x: ctx.theme.margin, y: ctx.y, size, font: ctx.regular, color: ctx.theme.accent,
      });
      ctx.y -= size + 4;
    }
    ctx.y -= ctx.theme.entryGap;
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

export async function renderResumePdf(
  rj: ResumeJson,
  contact: ContactDetails,
  templateId: string | null | undefined
): Promise<Uint8Array> {
  const theme = THEMES[resolveTemplate(templateId)];
  const doc = await PDFDocument.create();

  const bold = await doc.embedFont(theme.serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(theme.serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = {
    doc, page, bold, regular, theme,
    y: PAGE_H - theme.margin,
    contentW: PAGE_W - theme.margin * 2,
  };

  // ── Header ───────────────────────────────────────────────────────────────
  const name = contact.full_name?.trim() || "Candidate";
  ctx.page.drawText(name, {
    x: theme.margin, y: ctx.y, size: theme.nameSize, font: bold, color: theme.nameColor,
  });
  ctx.y -= theme.nameSize + 6;

  const contactLine = [contact.email, contact.phone, contact.current_city]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join("  ·  ");
  if (contactLine) {
    ctx.page.drawText(contactLine, {
      x: theme.margin, y: ctx.y, size: theme.contactSize, font: regular, color: GREY,
    });
    ctx.y -= 8;
  }

  if (theme.headerRule) {
    ctx.page.drawLine({
      start: { x: theme.margin, y: ctx.y },
      end: { x: theme.margin + ctx.contentW, y: ctx.y },
      thickness: 0.5,
      color: SUBTLE,
    });
    ctx.y -= 10;
  } else {
    ctx.y -= 4;
  }

  // ── Body, in the generator's chosen order ────────────────────────────────
  for (const section of resolveSectionOrder(rj)) {
    RENDERERS[section]?.(ctx, rj);
  }

  return doc.save();
}
