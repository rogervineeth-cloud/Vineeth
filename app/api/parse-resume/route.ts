import { NextRequest, NextResponse } from "next/server";
import { extractProfile } from "@/lib/resume-parser";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the upload UI

// pdfjs-dist's legacy build evaluates `const SCALE_MATRIX = new DOMMatrix()`
// at module top level. It tries to polyfill DOMMatrix from @napi-rs/canvas
// (an optionalDependency) when running under Node, but on Vercel the
// optional native binary isn't installed, the polyfill silently warns,
// and then the top-level `new DOMMatrix()` throws `ReferenceError:
// DOMMatrix is not defined` — killing the entire pdfjs module load and
// leaving the route stuck in its catch-all "couldn't read this PDF" path.
//
// We never RENDER PDFs, only call getTextContent(), so we don't need a
// real DOMMatrix. A minimal, no-op constructor on globalThis is enough to
// get past pdfjs's load-time evaluation. Same trick for ImageData and
// Path2D, which sit behind the same polyfill block in the legacy build.
function installPdfjsBrowserGlobalShims(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
      is2D = true;
      isIdentity = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      constructor(_init?: any) { /* no-op — we never render */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      multiply(_other: any) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      multiplySelf(_other: any) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      preMultiplySelf(_other: any) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      translate(_x?: number, _y?: number, _z?: number) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      translateSelf(_x?: number, _y?: number, _z?: number) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      scale(_sx?: number, _sy?: number) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      scaleSelf(_sx?: number, _sy?: number) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      rotate(_a?: number) { return this; }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      rotateSelf(_a?: number) { return this; }
      invertSelf() { return this; }
      inverse() { return this; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      setMatrixValue(_v: any) { return this; }
      toFloat32Array() { return new Float32Array(16); }
      toFloat64Array() { return new Float64Array(16); }
      toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
    };
  }
  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace = "srgb" as const;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        if (args[0] instanceof Uint8ClampedArray) {
          this.data = args[0];
          this.width = args[1] ?? 0;
          this.height = args[2] ?? Math.floor(args[0].length / 4 / Math.max(1, args[1] ?? 1));
        } else {
          this.width = args[0] ?? 0;
          this.height = args[1] ?? 0;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        }
      }
    };
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      constructor(_init?: any) { /* no-op */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      addPath(..._args: any[]) { /* no-op */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      moveTo(..._args: any[]) { /* no-op */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      lineTo(..._args: any[]) { /* no-op */ }
      closePath() { /* no-op */ }
    };
  }
}

// Resolve pdfjs-dist's legacy ESM entry. The shims above must be installed
// BEFORE this import runs so the top-level `new DOMMatrix()` inside the
// legacy build doesn't throw on Node runtimes without @napi-rs/canvas.
//
// pdfjs also tries to spin up a fake worker via a *dynamic* `import(workerSrc)`
// where `workerSrc` is a runtime-computed string ("./pdf.worker.mjs"). NFT
// can't trace runtime strings, so on Vercel that file is missing from the
// Lambda and pdfjs throws `Setting up fake worker failed: "Cannot find
// module .../pdf.worker.mjs"`. pdfjs gives us a documented escape hatch:
// if `globalThis.pdfjsWorker.WorkerMessageHandler` is set, it uses that
// directly and skips the dynamic worker import entirely. We do the worker
// import ourselves with a string literal — NFT traces that fine — then
// attach it to globalThis before getDocument runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdfjs(): Promise<any> {
  installPdfjsBrowserGlobalShims();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.pdfjsWorker?.WorkerMessageHandler) {
    // @ts-expect-error — pdfjs-dist ships no .d.ts for the worker subpath.
    const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    g.pdfjsWorker = workerModule as any;
  }
  return pdfjs;
}

// Extract plain text from a PDF using pdfjs-dist's legacy build directly.
// We avoid pdf-parse and the pdfjs worker entirely — both have failed reliably on
// Vercel/Lambda in the past (native @napi-rs/canvas binding, missing worker file).
// pdfjs-dist runs the parse on the main thread when no worker is configured,
// which is exactly what we want in a serverless function.
async function extractTextFromPdf(data: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdf: any | null = null;
  try {
    pdf = await loadingTask.promise;
    const pagesText: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = content.items as Array<any>;
        let lastY: number | null = null;
        let buf = "";
        for (const item of items) {
          if (typeof item.str !== "string") continue;
          const itemY: number | null = Array.isArray(item.transform) ? item.transform[5] : null;
          if (lastY !== null && itemY !== null && Math.abs(itemY - lastY) > 1) {
            buf += "\n";
          } else if (buf && !buf.endsWith(" ") && !buf.endsWith("\n")) {
            buf += " ";
          }
          buf += item.str;
          if (item.hasEOL) buf += "\n";
          lastY = itemY;
        }
        pagesText.push(buf);
      } finally {
        page.cleanup();
      }
    }
    return pagesText.join("\n");
  } finally {
    if (pdf) {
      try { await pdf.cleanup(); } catch { /* ignore */ }
      try { await pdf.destroy(); } catch { /* ignore */ }
    }
  }
}

function debugInfoFromErr(err: unknown): { name: string; message: string; code?: string } {
  const e = err as { name?: string; message?: string; code?: string } | null;
  return {
    name: e?.name ?? "Error",
    message: e?.message ?? String(err),
    code: e?.code,
  };
}

export async function POST(req: NextRequest) {
  // Allow callers to opt into a diagnostic payload that surfaces the
  // underlying error name/message — handy for live debugging without dumping
  // stack traces to every user. Pass `?debug=1` on the request URL.
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Please select a PDF to upload." }, { status: 400 });
    }
    const isPdfMime = file.type === "application/pdf";
    const isPdfName = /\.pdf$/i.test(file.name || "");
    if (!isPdfMime && !isPdfName) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "PDF too large — please upload a file under 5 MB." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Quick magic-byte sniff so corrupt/non-PDF uploads fail fast with a clear message.
    if (data.length < 5 || data[0] !== 0x25 || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x46) {
      return NextResponse.json({
        error: "This file doesn't look like a valid PDF. Please re-export and try again.",
        extracted: null,
        partial: true,
      }, { status: 200 });
    }

    let text: string;
    try {
      text = await extractTextFromPdf(data);
    } catch (err) {
      // Log full diagnostics server-side so we can debug future failures from logs.
      const info = debugInfoFromErr(err);
      console.error("[parse-resume] pdfjs extraction failed:", {
        ...info,
        stack: (err as { stack?: string } | null)?.stack,
      });
      if (info.name === "PasswordException" || /password/i.test(info.message)) {
        return NextResponse.json({
          error: "This PDF is password-protected. Please upload an unlocked copy.",
          extracted: null,
          partial: true,
          ...(debug ? { debug: info } : {}),
        }, { status: 200 });
      }
      if (info.name === "InvalidPDFException" || /invalid pdf/i.test(info.message)) {
        return NextResponse.json({
          error: "This file isn't a valid PDF. Please re-export and try again.",
          extracted: null,
          partial: true,
          ...(debug ? { debug: info } : {}),
        }, { status: 200 });
      }
      // Return partial success: empty extracted profile so the user can keep going
      // by filling fields manually rather than being blocked behind a hard error.
      return NextResponse.json({
        error: "We couldn't read this PDF automatically. Click \"Skip — fill manually\" to enter your details by hand.",
        extracted: null,
        partial: true,
        ...(debug ? { debug: info } : {}),
      }, { status: 200 });
    }

    if (!text.trim()) {
      return NextResponse.json({
        error: "We couldn't read any text from this PDF. If it's a scanned/image PDF, please re-export it as a text PDF (File → Save As PDF) and try again.",
        text: "",
        extracted: null,
        partial: true,
      }, { status: 200 });
    }

    // Parser is pure and best-effort: it never throws, but guard anyway so an
    // unexpected input shape can never 500 the route.
    let extracted = null;
    try {
      extracted = extractProfile(text);
    } catch (err) {
      console.error("[parse-resume] profile extraction failed:", err);
      return NextResponse.json({
        text,
        extracted: null,
        partial: true,
        error: "We read your PDF but couldn't auto-fill all fields. You can fill the rest manually.",
        ...(debug ? { debug: debugInfoFromErr(err) } : {}),
      }, { status: 200 });
    }
    return NextResponse.json({ text, extracted });
  } catch (err) {
    const info = debugInfoFromErr(err);
    console.error("[parse-resume] unexpected error:", info);
    return NextResponse.json({
      error: "Something went wrong on our side. Please try again, or click \"Skip — fill manually\" to enter your details by hand.",
      extracted: null,
      partial: true,
      ...(debug ? { debug: info } : {}),
    }, { status: 200 });
  }
}
