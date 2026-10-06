// What an ATS parser sees in a PDF, extracted with pdf.js (the engine behind
// Firefox's viewer and many parsing pipelines). Runs as its own Node process
// because pdfjs-dist ships ESM only, which ts-jest cannot load:
//
//   node __tests__/helpers/pdf-extract.mjs a.pdf [b.pdf …]  →  JSON on stdout
//
// For each file: page count, whether it has a form (AcroForm), and per page
// the text items in CONTENT-STREAM order (the order a parser reads them) with
// position, width and size, the annotation count, and how often each kind of
// drawing operator appears (fills, images, strokes, text).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const FONTS = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
const NAME = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
const FILLS = new Set(["fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke", "shadingFill"]);
const IMAGES = new Set(["paintImageXObject", "paintInlineImageXObject", "paintImageMaskXObject", "paintImageXObjectRepeat", "paintImageMaskXObjectGroup", "paintSolidColorImageMask", "paintFormXObjectBegin"]);

async function extract(file) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: FONTS, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      // pdf.js inserts whitespace-only items for gaps; they are not drawn text.
      .filter((i) => "str" in i && i.str.trim().length)
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.hypot(i.transform[2], i.transform[3]) }));
    const ops = { fill: 0, image: 0, stroke: 0, text: 0 };
    const list = await page.getOperatorList();
    list.fnArray.forEach((fn, k) => {
      let name = NAME[fn];
      // pdf.js 5 folds a path and the operator that paints it into one
      // constructPath, whose first argument is that painting operator.
      if (name === "constructPath") name = NAME[list.argsArray[k]?.[0]] ?? name;
      if (FILLS.has(name)) ops.fill++;
      else if (IMAGES.has(name)) ops.image++;
      else if (name === "stroke" || name === "closeStroke") ops.stroke++;
      else if (name === "showText" || name === "showSpacedText") ops.text++;
    });
    const view = page.view;
    pages.push({ width: view[2] - view[0], height: view[3] - view[1], items, ops, annotations: (await page.getAnnotations()).length });
  }
  const fields = await doc.getFieldObjects();
  const out = { file, pages: doc.numPages, hasForm: !!fields && Object.keys(fields).length > 0, pageData: pages };
  await doc.destroy();
  return out;
}

const results = [];
for (const f of process.argv.slice(2)) results.push(await extract(f));
process.stdout.write(JSON.stringify(results));
