import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const EXTRACTION_PROMPT = `You are a precise resume parser. Your job is to extract structured data from a resume or LinkedIn profile text.

Return ONLY valid JSON with this exact structure, no preamble, no markdown fences:
{
  "name": "string (full name only, not email/phone)",
  "email": "string (email address, or empty string if not found)",
  "phone": "string (phone number, or empty string if not found)",
  "city": "string (city/location, or empty string if not found)",
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

## CRITICAL RULES (follow exactly)

### Personal Info
- name: The person's actual full name only. Never put an email, phone, company name, or job title in the name field.
- email: A valid email address like user@domain.com. If not present, use empty string "".
- phone: Phone number digits. If not present, use empty string "".
- city: City or location where they live/work. If not present, use empty string "".

### Work Experience
- Each entry must have a real company name (not a section header like "Experience" or "References").
- role: The job title/position held at that company.
- duration: Format like "Jun 2022 – Present" or "Jan 2020 – Dec 2021". If only year, use "2020 – 2022".
- bullets: The actual responsibilities and achievements listed under that job. These are FULL sentences describing what they did, NOT the company name or job title.
- Do NOT include contact information (email, phone, city) in the bullets array.
- A bullet like "Used Python to automate reports" is valid. A bullet like "Reno Kurian" or "renokurian@gmail.com" is NOT a bullet - skip it.

### Education
- institution: Must be a real school, college, or university name.
- Do NOT put section headers ("References", "Languages", "Skills"), contact info (emails, phone numbers, names), or job descriptions in the institution field.
- Each education entry must have a real degree (B.Tech, MBA, B.Sc, etc.) or at minimum a recognizable institution name.
- If a line in the text looks like a reference ("Reno Kurian, renokurian@gmail.com") or a section header ("References", "Languages & Tools"), do NOT include it in education.

### Skills
- List only actual technical tools, technologies, programming languages, frameworks, platforms, or domain-specific professional skills.
- Skills should be short (1-4 words): "React", "Python", "Machine Learning", "Project Management".
- Do NOT include: email addresses, phone numbers, city names, people's names, sentence fragments, job titles, or partial words.
- A valid skill looks like: "JavaScript", "Power BI", "Agile". An invalid skill looks like: "Experienced professional", "renokurian@gmail", "Bengaluru".

### Projects
- Only include items that are clearly personal/academic/open-source projects.
- Do NOT include work experience as projects.

### Other rules
- graduation_year: Integer year of most recent or upcoming degree, or null if not determinable.
- summary: Extract a professional summary if one is explicitly present in the text, otherwise null.
- If a section is absent in the text, use an empty array [] (not null).
- cgpa: Include only if explicitly stated as a number/grade, otherwise omit the field.
- Return ONLY the JSON object, nothing else.`;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (await import("pdf-parse")) as any;
    const { text } = await pdfParse.default(buffer);

    if (!text?.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from this PDF. Try a different file." },
        { status: 422 }
      );
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: EXTRACTION_PROMPT,
      messages: [{
        role: "user",
        content: `Extract all resume data from this text. Apply the CRITICAL RULES strictly — especially for skills (no emails/phone/city/names) and education (no references/headers/contact info).\n\n${text.slice(0, 8000)}`
      }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

    let extracted;
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("Resume parse AI response not valid JSON:", raw.slice(0, 300));
      return NextResponse.json({ text, extracted: null, partial: true });
    }

    // Post-extraction sanity: strip obviously wrong skills (emails, phone, long sentences)
    if (Array.isArray(extracted.skills)) {
      extracted.skills = extracted.skills.filter((s: string) => {
        if (!s || typeof s !== "string") return false;
        const t = s.trim();
        if (t.includes("@") || /^\+?[\d\s\-]{7,}$/.test(t)) return false; // email/phone
        if (t.split(" ").length > 5) return false; // sentence fragment
        if (t.length > 40) return false; // too long
        return true;
      });
    }

    // Post-extraction sanity: strip obviously wrong education entries
    if (Array.isArray(extracted.education)) {
      extracted.education = extracted.education.filter((e: { institution?: string }) => {
        if (!e?.institution?.trim()) return false;
        const inst = e.institution.trim();
        // Filter out contact info, section headers, and reference names that slipped through
        if (inst.includes("@")) return false;
        if (/^(references|languages|skills|projects|experience|education|certifications|awards)$/i.test(inst)) return false;
        return true;
      });
    }

    return NextResponse.json({ text, extracted });
  } catch (err) {
    console.error("Resume parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse resume. Please try again." },
      { status: 500 }
    );
  }
}
