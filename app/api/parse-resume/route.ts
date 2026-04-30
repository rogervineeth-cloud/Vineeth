import { NextRequest, NextResponse } from "next/server";
import { extractProfile } from "@/lib/resume-parser";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the upload UI

// Extract plain text from a PDF using pdfjs-dist's legacy build directly.
// We avoid pdf-parse and the pdfjs worker entirely — both have failed reliably on
// Vercel/Lambda in the past (native @napi-rs/canvas binding, missing worker file).
// pdfjs-dist runs the parse on the main thread when no worker is configured,
// which is exactly what we want in a serverless function.
async function extractTextFromPdf(data: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as any;

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

export async function POST(req: NextRequest) {
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
      console.error("[parse-resume] pdfjs extraction failed:", {
        name: (err as { name?: string } | null)?.name,
        message: (err as { message?: string } | null)?.message,
        stack: (err as { stack?: string } | null)?.stack,
      });
      const name = (err as { name?: string } | null)?.name ?? "";
      const message = (err as { message?: string } | null)?.message ?? "";
      if (name === "PasswordException" || /password/i.test(message)) {
        return NextResponse.json({
          error: "This PDF is password-protected. Please upload an unlocked copy.",
          extracted: null,
          partial: true,
        }, { status: 200 });
      }
      if (name === "InvalidPDFException" || /invalid pdf/i.test(message)) {
        return NextResponse.json({
          error: "This file isn't a valid PDF. Please re-export and try again.",
          extracted: null,
          partial: true,
        }, { status: 200 });
      }
      // Return partial success: empty extracted profile so the user can keep going
      // by filling fields manually rather than being blocked behind a hard error.
      return NextResponse.json({
        error: "We couldn't read this PDF automatically. Click \"Skip — fill manually\" to enter your details by hand.",
        extracted: null,
        partial: true,
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
      }, { status: 200 });
    }
    return NextResponse.json({ text, extracted });
  } catch (err) {
    console.error("[parse-resume] unexpected error:", err);
    return NextResponse.json({
      error: "Something went wrong on our side. Please try again, or click \"Skip — fill manually\" to enter your details by hand.",
      extracted: null,
      partial: true,
    }, { status: 200 });
  }
}
