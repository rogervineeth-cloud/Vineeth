// Plain text from pdf.js getTextContent() items, one line per visual line.
//
// Pure (no pdfjs import) so it can be unit-tested against real extracted
// items; app/api/parse-resume calls it with each page's items.
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

export function assemblePdfText(items: PdfTextItem[]): string {
  let buf = "";
  let lastY: number | null = null;
  let lastEnd: number | null = null; // x where the previous non-blank item ended
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const t = Array.isArray(item.transform) ? (item.transform as number[]) : null;
    const x = t && typeof t[4] === "number" ? t[4] : null;
    const y = t && typeof t[5] === "number" ? t[5] : null;
    const width = typeof item.width === "number" ? item.width : 0;
    const newLine = lastY !== null && y !== null && Math.abs(y - lastY) > 1;
    if (newLine) {
      buf += "\n";
      lastEnd = null;
    }
    const blank = item.str.trim() === "";
    if (blank) {
      // A wide blank item on a line that already has text is a column gap.
      if (width >= MIN_COLUMN_GAP && buf && !buf.endsWith("\n") && !buf.endsWith(COLUMN_GAP)) buf = buf.replace(/ +$/, "") + COLUMN_GAP;
      else if (buf && !buf.endsWith(" ") && !buf.endsWith("\n") && !buf.endsWith(COLUMN_GAP)) buf += " ";
    } else {
      if (buf && !buf.endsWith("\n") && !buf.endsWith(" ") && !buf.endsWith(COLUMN_GAP)) {
        // Same line, no blank item between: a wide jump in x is a gap too.
        buf += lastEnd !== null && x !== null && x - lastEnd >= MIN_COLUMN_GAP ? COLUMN_GAP : " ";
      }
      buf += item.str;
      lastEnd = x !== null ? x + width : null;
    }
    if (item.hasEOL) {
      buf += "\n";
      lastEnd = null;
    }
    if (y !== null) lastY = y;
  }
  return buf;
}
