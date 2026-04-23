import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canGenerateResume, canGenerateFreeRegen, consumeCredit } from "@/lib/plans";

export const maxDuration = 60;

const inputSchema = z.object({
  jd_text: z.string().min(100, "Job description too short (min 100 chars)"),
  jd_url: z.string().url().optional().or(z.literal("")),
  regen_of_resume_id: z.string().uuid().optional(),
  user_profile: z.object({
    full_name: z.string(),
    email: z.string(),
    phone: z.string().nullable().optional(),
    current_city: z.string().nullable().optional(),
    graduation_year: z.number().nullable().optional(),
    target_roles: z.array(z.string()).optional(),
    linkedin_data: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

const SYSTEM_PROMPT = `You are an expert Indian career coach and ATS-optimization specialist. You help students and job seekers in India tailor their resumes to specific job descriptions.

You will receive a user's background (from LinkedIn) and a target job description.

Your task:
1. KEYWORDS: Extract 8-12 critical keywords/skills from the JD (technical skills, tools, methodologies, soft skills explicitly mentioned)
2. EXPERIENCE TAILORING: Rewrite each of the user's experience bullets to:
   - Start with a strong action verb (Led, Built, Implemented, Designed, Delivered, etc.)
   - Naturally incorporate JD keywords where truthful (never fabricate)
   - Include measurable outcomes where the original mentioned them
   - Each bullet: 1-2 lines max, specific, results-focused
3. SUMMARY: Write a 2-3 sentence professional summary positioning the user for this specific role. Must mention years of experience, key skills relevant to JD, and career objective.
4. SKILLS: Organize skills by relevance — JD-matched skills first, then adjacent skills. Exclude irrelevant skills.
5. ATS SCORE: Calculate 0-100 based on:
   - Keyword match density (40%)
   - Experience relevance to JD (30%)
   - Skills overlap (20%)
   - Format/structure quality (10%)
   Be realistic — most resumes score 60-85. Perfect 100 is rare.
6. FEEDBACK: List up to 5 missing keywords the user should consider adding (if they have that experience truthfully).

Output requirements:
- Return ONLY valid JSON, no preamble, no explanation, no markdown code fences
- Use this exact structure:
{
  "summary": "string",
  "experience": [
    { "company": "string", "role": "string", "duration": "string", "location": "string", "bullets": ["string"] }
  ],
  "skills": ["string"],
  "education": [
    { "institution": "string", "degree": "string", "year": "string", "location": "string", "cgpa": "string" }
  ],
  "projects": [
    { "name": "string", "description": "string", "tech": ["string"] }
  ],
  "ats_score": 75,
  "matched_keywords": ["string"],
  "missing_keywords": ["string"],
  "tailored_role": "string"
}

Constraints:
- Keep total word count ~500 words (fits one page)
- Never invent experience the user doesn't have
- Indian English conventions (₹ for currency)
- If user profile is thin, focus on education and projects`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = inputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { jd_text, jd_url, user_profile, regen_of_resume_id } = parsed.data;

    // Auth
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // Credit gating
    let isFreeRegen = false;
    if (regen_of_resume_id) {
      isFreeRegen = await canGenerateFreeRegen(userId, regen_of_resume_id);
    }

    if (!isFreeRegen) {
      const { allowed, reason } = await canGenerateResume(userId);
      if (!allowed) {
        return NextResponse.json(
          { error: "PAYMENT_REQUIRED", reason, upgrade_url: "/pricing" },
          { status: 402 }
        );
      }
    }

    // Call Anthropic
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify({ user_profile, jd_text, jd_url: jd_url || null }) }],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";

    let resumeJson;
    try {
      const cleaned = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      resumeJson = JSON.parse(cleaned);
    } catch {
      // JSON parse failure — do NOT consume credit
      console.error("Failed to parse AI response:", rawText.slice(0, 500));
      return NextResponse.json(
        { error: "AI returned invalid JSON. Please try again." },
        { status: 500 }
      );
    }

    // Consume credit only after a successful parse
    if (!isFreeRegen) {
      const credited = await consumeCredit(userId);
      if (!credited) {
        // Race condition — credit check passed but consume failed; treat as exhausted
        return NextResponse.json(
          { error: "PAYMENT_REQUIRED", reason: "CREDITS_EXHAUSTED", upgrade_url: "/pricing" },
          { status: 402 }
        );
      }
    }

    return NextResponse.json({
      resume_json: resumeJson,
      is_free_regen: isFreeRegen,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Generate resume error:", msg);

    if (msg.includes("401") || msg.includes("authentication") || msg.includes("API key")) {
      return NextResponse.json({ error: "Configuration error. Please contact support." }, { status: 500 });
    }
    if (msg.includes("credit") || msg.includes("402") || msg.includes("billing")) {
      return NextResponse.json({ error: "Service temporarily unavailable. Please try again later." }, { status: 500 });
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      return NextResponse.json({ error: "Generation timed out — please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Resume generation failed. Please try again." }, { status: 500 });
  }
}
