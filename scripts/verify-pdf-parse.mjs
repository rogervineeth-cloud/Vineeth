// Smoke test for the PDF text extractor used by /api/parse-resume.
// Generates a small text PDF in-memory and asserts pdf-parse v2 returns the text.
// Run with: node scripts/verify-pdf-parse.mjs
import { PDFParse } from "pdf-parse";
import { PDFDocument, StandardFonts } from "pdf-lib";

const SAMPLE_LINES = [
  "Jane Doe",
  "jane@example.com  +91 98765 43210  Kochi, India",
  "",
  "Experience",
  "Acme Corp — Software Engineer (Jun 2022 – Present)",
  "- Built the resume parser",
  "",
  "Education",
  "IIT Madras — B.Tech, 2022",
  "",
  "Skills",
  "TypeScript, React, Node, PostgreSQL",
];

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  let y = 750;
  for (const line of SAMPLE_LINES) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 18;
  }
  return Buffer.from(await doc.save());
}

async function main() {
  const buffer = await makePdf();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = (result.text ?? "").trim();
    if (!text.includes("Jane Doe")) throw new Error("Expected 'Jane Doe' in extracted text");
    if (!text.includes("jane@example.com")) throw new Error("Expected email in extracted text");
    if (!text.includes("Acme Corp")) throw new Error("Expected experience entry in extracted text");
    if (!text.includes("TypeScript")) throw new Error("Expected skills in extracted text");
    console.log("OK — pdf-parse v2 extracted", text.length, "chars from a text PDF");
  } finally {
    await parser.destroy();
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
