// Plain text from pdf.js getTextContent() items, one line per visual line.
//
// Pure (no pdfjs import) so it can be unit-tested against real extracted
// items; app/api/parse-resume calls assemblePdfPages with every page's items.
//
// COLUMN GAPS. Many resumes — including this app's own PDFs (lib/resume-pdf
// drawSplitMetaRow / drawTitleRow) — put text flush right on the same line as
// text on the left: "Zoho Corporation ........ Chennai", "B.Tech ........
// 2022-2026". pdf.js reports the space between as one wide whitespace item.
// Joining it with a single space glued the columns together, so an import
// read the company as "Zoho Corporation Chennai" and an institution as
// "College ... · 8.4 CGPA Thiruvananthapuram, Kerala" (production QA, 27 Oct
// 2026). A gap wider than a few characters is now kept as a TAB, which
// lib/resume-parser reads as a column boundary in experience and education
// and as an ordinary space everywhere else.
//
// WRAPPED BULLETS. A bullet too long for one line continues on the next
// line(s) at the bullet TEXT's x — a hanging indent, with no glyph of its own.
// Each visual line used to become its own line of text, so "... cutting
// deploy time from 40 to 8" / "minutes." imported as two bullets. A line is
// now joined to the bullet above it only when it has no bullet glyph and
// starts where that bullet's text starts (within 1.5pt); a new bullet, a
// paragraph back at the margin or any other indent stays a line of its own.
// This carries across a page break.

export const COLUMN_GAP = "\t";

export type PdfTextItem = {
  str?: unknown;
  /** [a, b, c, d, x, y] */
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  hasEOL?: unknown;
};

/** Horizontal gap, in points, that counts as a column boundary (≥ ~4 spaces at body size). */
const MIN_COLUMN_GAP = 18;
/** How far a continuation line's start may be from its bullet's text start. */
const INDENT_TOLERANCE = 1.5;
const BULLET_GLYPH = /^[•·●▪◦‣■□➢►▸*\-–—]$/;

type Line = {
  text: string;
  /** x of the first non-blank item. */
  x0: number | null;
  /** For a line that opens with a bullet glyph: x where its text starts. */
  bulletTextX: number | null;
  /** First non-blank item is a lone bullet glyph. */
  opensWithGlyph: boolean;
};

function linesOf(items: PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  let cur: Line = { text: "", x0: null, bulletTextX: null, opensWithGlyph: false };
  let words = 0; // non-blank items on the current line
  let lastY: number | null = null;
  let lastEnd: number | null = null; // x where the previous non-blank item ended
  const endLine = () => {
    lines.push(cur);
    cur = { text: "", x0: null, bulletTextX: null, opensWithGlyph: false };
    words = 0;
    lastEnd = null;
  };
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const t = Array.isArray(item.transform) ? (item.transform as number[]) : null;
    const x = t && typeof t[4] === "number" ? t[4] : null;
    const y = t && typeof t[5] === "number" ? t[5] : null;
    const width = typeof item.width === "number" ? item.width : 0;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 1) endLine();
    const buf = cur.text;
    if (item.str.trim() === "") {
      // A wide blank item on a line that already has text is a column gap.
      if (width >= MIN_COLUMN_GAP && buf && !buf.endsWith(COLUMN_GAP)) cur.text = buf.replace(/ +$/, "") + COLUMN_GAP;
      else if (buf && !buf.endsWith(" ") && !buf.endsWith(COLUMN_GAP)) cur.text += " ";
    } else {
      if (buf && !buf.endsWith(" ") && !buf.endsWith(COLUMN_GAP)) {
        // Same line, no blank item between: a wide jump in x is a gap too.
        cur.text += lastEnd !== null && x !== null && x - lastEnd >= MIN_COLUMN_GAP ? COLUMN_GAP : " ";
      }
      if (words === 0) {
        cur.x0 = x;
        cur.opensWithGlyph = BULLET_GLYPH.test(item.str.trim());
      } else if (words === 1 && cur.opensWithGlyph) {
        cur.bulletTextX = x;
      }
      cur.text += item.str;
      words++;
      lastEnd = x !== null ? x + width : null;
    }
    if (item.hasEOL) endLine();
    if (y !== null) lastY = y;
  }
  lines.push(cur);
  return lines;
}

/**
 * Text of several pages, in order, with wrapped bullets joined (also across
 * a page break). Equivalent to joining each page's assemblePdfText with "\n"
 * apart from those joins.
 */
export function assemblePdfPages(pages: PdfTextItem[][]): string {
  const out: string[] = [];
  // The bullet the next continuation line may belong to: its index in `out`
  // and where its text starts. Blank lines between do not end it.
  let open: { index: number; textX: number } | null = null;
  for (const items of pages) {
    for (const line of linesOf(items)) {
      if (!line.text.trim()) {
        out.push(line.text);
        continue;
      }
      if (
        open && !line.opensWithGlyph && line.x0 !== null &&
        Math.abs(line.x0 - open.textX) <= INDENT_TOLERANCE && !line.text.includes(COLUMN_GAP)
      ) {
        // Drop the blank lines between, then join with one space.
        out.length = open.index + 1;
        out[open.index] = `${out[open.index].replace(/\s+$/, "")} ${line.text.trim()}`;
        continue;
      }
      out.push(line.text);
      open = line.opensWithGlyph && line.bulletTextX !== null ? { index: out.length - 1, textX: line.bulletTextX } : null;
    }
  }
  return out.join("\n");
}

/** Text of one page's items. */
export function assemblePdfText(items: PdfTextItem[]): string {
  return assemblePdfPages([items]);
}
