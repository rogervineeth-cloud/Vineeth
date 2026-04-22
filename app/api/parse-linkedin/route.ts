import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Dynamically import pdf-parse to avoid build issues with Next.js
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (await import("pdf-parse")) as any;
    const data = await pdfParse.default(buffer);
    const text = data.text;

    // Best-effort heuristic extraction from LinkedIn PDF
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
