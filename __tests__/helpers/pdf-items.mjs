// Raw pdf.js text items for each page of each PDF, exactly as
// app/api/parse-resume receives them from getTextContent() (same legacy
// build, same options). ESM-only pdfjs cannot load under ts-jest, so tests
// run this as a child process:
//
//   node __tests__/helpers/pdf-items.mjs a.pdf [b.pdf …]  →  JSON on stdout
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const out = [];
for (const file of process.argv.slice(2)) {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(file)),
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((i) => ({ str: i.str, transform: i.transform, width: i.width, height: i.height, hasEOL: i.hasEOL })));
  }
  await doc.destroy();
  out.push(pages);
}
process.stdout.write(JSON.stringify(out));
