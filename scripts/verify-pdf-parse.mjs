#!/usr/bin/env node
// PDF round-trip smoke test.
//
// Builds a minimal text PDF in-memory with pdf-lib, hands the bytes to the
// same pdfjs-dist legacy entry the parse-resume route uses, and asserts that
// the extracted text is non-empty and contains the seeded markers. Catches
// regressions in the serverless PDF extraction stack (pdfjs worker config,
// font handling, etc.) without needing a deployed Vercel function.
//
// Run with: `node scripts/verify-pdf-parse.mjs`
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function buildSamplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const lines = [
    "Sample Resume",
    "sample.candidate@example.com  |  +91 98765 43210",
    "",
    "EXPERIENCE",
    "Software Engineer at TestCo (Jan 2020 - Present)",
    "- Shipped feature A",
    "- Shipped feature B",
    "",
    "SKILLS: Python, JavaScript, Go",
  ];
  let y = 760;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font, color: rgb(0, 0, 0) });
    y -= 18;
  }
  return await doc.save();
}

async function extractTextFromPdf(data) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const buf = content.items.map((it) => (typeof it.str === "string" ? it.str : "")).join(" ");
        pages.push(buf);
      } finally {
        page.cleanup();
      }
    }
    return pages.join("\n");
  } finally {
    try { await pdf.cleanup(); } catch { /* ignore */ }
    try { await pdf.destroy(); } catch { /* ignore */ }
  }
}

async function main() {
  const bytes = await buildSamplePdf();
  const text = await extractTextFromPdf(bytes);
  const must = ["Sample Resume", "sample.candidate@example.com", "EXPERIENCE", "SKILLS", "Python"];
  let ok = true;
  for (const needle of must) {
    if (!text.includes(needle)) {
      console.error(`✗ missing in extracted text: ${needle}`);
      ok = false;
    }
  }
  if (!ok) {
    console.error("\n--- extracted ---\n" + text);
    process.exit(1);
  }
  console.log("✓ PDF round-trip OK — extracted text contains all markers.");
}

main().catch((err) => {
  console.error("✗ verify-pdf-parse failed:", err);
  process.exit(1);
});
