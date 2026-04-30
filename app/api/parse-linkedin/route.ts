import { NextRequest, NextResponse } from "next/server";
import "pdf-parse/worker";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        text = (result.text ?? "").trim();
      } finally {
        await parser.destroy().catch(() => {});
      }
    } catch (parseErr) {
      console.error("PDF text extraction failed:", parseErr);
      return NextResponse.json(
        { error: "We couldn't read this PDF. It may be scanned or image-based — try re-exporting as a text PDF, or click 'Skip — fill manually'." },
        { status: 422 },
      );
    }

    if (!text) {
      return NextResponse.json(
        { error: "No selectable text found in this PDF. Please re-export as a text PDF or skip and fill manually." },
        { status: 422 },
      );
    }

    const extracted = parseLinkedInText(text);

    return NextResponse.json({ text, extracted });
  } catch (err) {
    console.error("PDF parse error:", err);
    return NextResponse.json({ error: "Failed to parse PDF" }, { status: 500 });
  }
}

function parseLinkedInText(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Name is usually one of the first non-empty lines
  const name = lines[0] ?? "";

  // Headline is typically line 1 or 2
  const headline = lines[1] ?? "";

  // Extract email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0] ?? "";

  // Extract phone
  const phoneMatch = text.match(/(\+91[-\s]?)?[6-9]\d{9}/);
  const phone = phoneMatch?.[0] ?? "";

  // Extract city — look for common Indian cities
  const cities = ["Mumbai", "Delhi", "Bangalore", "Bengaluru", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Kochi", "Trivandrum", "Jaipur", "Lucknow", "Chandigarh", "Coimbatore", "Noida", "Gurugram", "Gurgaon", "Indore", "Bhopal", "Nagpur"];
  const cityMatch = cities.find((c) => text.includes(c));

  return { name, headline, email, phone, city: cityMatch ?? "" };
}
