// Visual QA for the resume PDF styles (lib/resume-pdf.ts).
//
//   npx tsx scripts/render-style-previews.ts
//
// Renders every offered style × fictional profile (__tests__/helpers/
// resume-fixtures.ts) to docs/visual-qa/resume-styles/*.pdf, then — when
// Playwright and a Chromium are available — rasterises each page with pdf.js
// to a PNG beside it, and refreshes the picker thumbnails in
// public/template-previews/{style}.png from the "experienced" profile.
// Nothing here touches a database or the network.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { layoutResumePdf } from "@/lib/resume-pdf";
import { TEMPLATE_IDS } from "@/lib/templates";
import { FIXTURES, EXPERIENCED } from "@/__tests__/helpers/resume-fixtures";

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "visual-qa", "resume-styles");
const PREVIEWS = path.join(ROOT, "public", "template-previews");

type Rendered = { file: string; style: string; fixture: string; pages: number };

async function writePdfs(): Promise<Rendered[]> {
  mkdirSync(OUT, { recursive: true });
  const out: Rendered[] = [];
  for (const style of TEMPLATE_IDS) {
    for (const f of FIXTURES) {
      const laid = await layoutResumePdf(f.resume, f.contact, style);
      const file = path.join(OUT, `${style}-${f.id}.pdf`);
      writeFileSync(file, laid.bytes);
      out.push({ file, style, fixture: f.id, pages: laid.pages });
    }
  }
  return out;
}

// The few Playwright calls used here. Playwright is not a project dependency
// (CI does not need it); it is loaded from wherever it is installed.
type Route = { request(): { url(): string }; fulfill(o: { status?: number; contentType?: string; body: string | Buffer }): Promise<void> };
type Page = {
  route(pattern: string, handler: (r: Route) => Promise<void>): Promise<void>;
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  locator(selector: string): { screenshot(o: { path: string }): Promise<unknown> };
};
type Playwright = { chromium: { launch(o: { executablePath?: string }): Promise<{ newPage(o: { deviceScaleFactor: number }): Promise<Page>; close(): Promise<void> }> } };
type RenderWindow = { ready?: boolean; renderPdf: (url: string, page: number, width: number) => Promise<[number, number]> };

function loadPlaywright(): Playwright | null {
  for (const base of [ROOT, (() => { try { return execSync("npm root -g", { encoding: "utf8" }).trim(); } catch { return ""; } })()]) {
    try {
      return createRequire(path.join(base, "noop.js"))(base === ROOT ? "playwright" : path.join(base, "playwright"));
    } catch { /* try the next location */ }
  }
  return null;
}

const PAGE_HTML = `<!doctype html><html><body style="margin:0;background:#fff">
<script type="module">
import * as pdfjs from "/pdfjs/build/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.mjs";
window.renderPdf = async (url, pageNo, width) => {
  const doc = await pdfjs.getDocument({ url, standardFontDataUrl: "/pdfjs/standard_fonts/" }).promise;
  const page = await doc.getPage(pageNo);
  const scale = width / page.getViewport({ scale: 1 }).width;
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  document.body.replaceChildren(c);
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return [c.width, c.height];
};
window.ready = true;
</script></body></html>`;

async function rasterise(rendered: Rendered[]) {
  const pw = loadPlaywright();
  const executablePath = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
  if (!pw) { console.log("Playwright not found — PDFs written, PNGs skipped."); return; }
  const browser = await pw.chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const dist = path.join(ROOT, "node_modules", "pdfjs-dist");
  await page.route("http://qa.local/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/") return route.fulfill({ contentType: "text/html", body: PAGE_HTML });
    if (p.startsWith("/pdfjs/")) {
      const rel = p.slice("/pdfjs/".length); // build/… (legacy build) or standard_fonts/…
      const file = rel.startsWith("build/") ? path.join(dist, "legacy", rel) : path.join(dist, rel);
      return route.fulfill({ contentType: file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream", body: readFileSync(file) });
    }
    if (p.startsWith("/out/")) return route.fulfill({ contentType: "application/pdf", body: readFileSync(path.join(OUT, decodeURIComponent(p.slice(5)))) });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("http://qa.local/");
  await page.waitForFunction(() => (window as unknown as RenderWindow).ready === true);

  const shot = async (pdf: string, pageNo: number, width: number, dest: string) => {
    const [w, h] = await page.evaluate(([u, n, wd]) => (window as unknown as RenderWindow).renderPdf(u, n, wd), [`/out/${pdf}`, pageNo, width] as [string, number, number]);
    await page.setViewportSize({ width: w, height: h });
    await page.locator("canvas").screenshot({ path: dest });
  };

  for (const r of rendered) {
    for (let n = 1; n <= r.pages; n++) {
      const name = path.basename(r.file, ".pdf") + (r.pages > 1 ? `-p${n}` : "") + ".png";
      await shot(path.basename(r.file), n, 900, path.join(OUT, name));
    }
  }
  // Picker thumbnails (shown ~300px wide; rendered at 1.5x for sharp screens).
  for (const style of TEMPLATE_IDS) await shot(`${style}-${EXPERIENCED.id}.pdf`, 1, 630, path.join(PREVIEWS, `${style}.png`));
  await browser.close();
}

(async () => {
  const rendered = await writePdfs();
  await rasterise(rendered);
  for (const r of rendered) console.log(`${path.relative(ROOT, r.file)}  ${r.pages} page(s)`);
})().catch((e) => { console.error(e); process.exit(1); });
