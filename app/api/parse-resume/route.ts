import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import "pdf-parse/worker";

export const runtime = "nodejs";
export const maxDuration = 30;

const EXTRACTION_PROMPT = `You are a resume parser. Extract all information from this resume or LinkedIn profile text and return it as JSON.

Return ONLY valid JSON with this exact structure, no preamble, no markdown fences:
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "city": "string",
  "graduation_year": null,
  "summary": null,
  "experience": [
    {"company": "string", "role": "string", "duration": "string", "location": "string", "bullets": ["string"]}
  ],
  "education": [
    {"institution": "string", "degree": "string", "year": "string", "location": "string", "cgpa": "string"}
  ],
  "skills": ["string"],
  "projects": [
    {"name": "string", "description": "string", "tech": ["string"]}
  ]
}

Rules:
- Extract ALL work experience including internships
- Duration format: "Jun 2022 – Present" or "Jan 2020 – Dec 2021"
- graduation_year: integer (year of most recent or upcoming degree), or null
- summary: a brief professional summary if present, or null
- If a section is absent in the text, use an empty array []
- cgpa: include only if explicitly mentioned, otherwise omit the field
- For bullets, extract the actual responsibilities and achievements listed
- For skills, list all technical tools, technologies, and domain skills mentioned
- Return ONLY the JSON object, nothing else`;

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF file required" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";
    try {
      text = await extractPdfText(buffer);
    } catch (parseErr) {
      console.error("PDF text extraction failed:", parseErr);
      return NextResponse.json(
        { error: "We couldn't read this PDF. It may be scanned or image-based — try re-exporting as a text PDF, or click 'Skip — fill manually' to enter your details by hand." },
        { status: 422 },
      );
    }

    if (!text) {
      return NextResponse.json(
        { error: "No selectable text found in this PDF. If it's scanned, please re-export as a text PDF or click 'Skip — fill manually'." },
        { status: 422 },
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("ANTHROPIC_API_KEY missing — returning raw text only");
      return NextResponse.json({ text, extracted: null, partial: true });
    }

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: EXTRACTION_PROMPT,
        messages: [{ role: "user", content: `Extract all resume data from this text:\n\n${text.slice(0, 8000)}` }],
      });

      const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
      const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

      let extracted;
      try {
        extracted = JSON.parse(cleaned);
      } catch {
        console.error("Resume parse AI response not valid JSON:", raw.slice(0, 300));
        return NextResponse.json({ text, extracted: null, partial: true });
      }

      return NextResponse.json({ text, extracted });
    } catch (aiErr) {
      console.error("Anthropic extraction failed:", aiErr);
      return NextResponse.json({ text, extracted: null, partial: true });
    }
  } catch (err) {
    console.error("Resume parse error:", err);
    return NextResponse.json({ error: "Failed to parse resume. Please try again." }, { status: 500 });
  }
}
