import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canGenerateResume, canGenerateFreeRegen, consumeCredit } from "@/lib/plans";

export const maxDuration = 60;

const CREATOR_EMAIL = "rogervineeth@gmail.com";

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
    // Rich profile data from the /profile editor
    summary: z.string().optional(),
    experience: z.array(z.object({
      company: z.string(), role: z.string(), duration: z.string(),
      location: z.string(), bullets: z.array(z.string()),
    })).optional(),
    skills: z.array(z.string()).optional(),
    education: z.array(z.object({
      institution: z.string(), degree: z.string(), year: z.string(),
      location: z.string(), cgpa: z.string().optional(),
    })).optional(),
    projects: z.array(z.object({
      name: z.string(), description: z.string(), tech: z.array(z.string()),
    })).optional(),
  }),
});

const SYSTEM_PROMPT = `You are an expert resume strategist who specializes in the Indian job market. You help students, freshers, and working professionals tailor their resumes for specific roles at Indian and global companies hiring in India.

You will receive two inputs:
1. A USER PROFILE containing their personal info, education, experience, skills, projects, and target roles
2. A TARGET JOB DESCRIPTION (JD) for a role they want

Your task is to produce a single JSON output that represents a polished, ATS-optimized resume tailored to this specific JD, using only truthful information from the user's profile.

## CORE PRINCIPLES (non-negotiable)

1. NEVER FABRICATE: You may rephrase, reorganize, and emphasize the user's information — but you must never invent a skill, job, project, or achievement that isn't in their profile. If the user has no relevant experience for the JD, do your best with what they have and be honest in the summary.

2. TRUTH-PRESERVING TAILORING: When rewording a bullet to match JD keywords, the underlying meaning must stay true. "Managed Excel reports" can become "Analyzed operational data using advanced spreadsheet modeling" — that's fair. It cannot become "Built data pipelines" — that's fabrication.

3. INDIAN MARKET FIT:
   - Use Indian English conventions (spelling, idiom)
   - Use ₹ for salaries/budgets (not $ or €)
   - Recognize Indian company names as-is (Reliance, Infosys, TCS, Flipkart)
   - Recognize Indian qualifications (B.Tech, B.E., MBA, CA, M.Com)
   - For fresher resumes, lead with education + projects; for experienced professionals, lead with experience

4. JD-DRIVEN:
   - Extract 8-12 critical keywords from the JD (hard skills, tools, soft skills mentioned, domain terms)
   - Rewrite experience bullets to naturally incorporate these keywords where the user actually did related work
   - Prioritize and reorder skills section so JD-matched skills appear first

## OUTPUT STRUCTURE (return ONLY this JSON, no preamble, no markdown fences)

{
  "summary": "2-3 sentences positioning the user for this specific role. Mention relevant experience length, key skills matching the JD, and career intent.",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "duration": "string in format: 'Jun 2023 – Present' or 'Aug 2020 – May 2023'",
      "location": "string (optional, only if in profile)",
      "bullets": ["3-5 bullets per role, each 1-2 lines, starting with strong action verbs"]
    }
  ],
  "skills": ["ordered array: JD-matched skills first, then adjacent skills, max 15"],
  "education": [
    {
      "institution": "string",
      "degree": "string (e.g., 'B.Tech in Computer Science')",
      "year": "string (e.g., '2024' or '2020-2024')",
      "location": "string (optional)",
      "gpa": "string (optional, only if provided)"
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "1-2 lines describing the project and outcome",
      "tech": ["relevant technologies"]
    }
  ],
  "ats_score": "integer 0-100",
  "matched_keywords": ["keywords from JD that appear in this resume"],
  "missing_keywords": ["up to 5 JD keywords the user should consider adding IF they truthfully have that experience"],
  "tailored_role": "the job title this resume is targeting (derived from JD)"
}

## ATS SCORING FORMULA

Calculate ats_score using:
- 40% — Keyword match density (what % of JD keywords appear in the resume)
- 30% — Experience relevance (does their experience align with the JD's requirements)
- 20% — Skills section overlap with JD
- 10% — Structure quality (bullet clarity, quantification, action verbs)

Be realistic. Most resumes score 60-85. Scores above 90 should be rare and deserved. A fresher applying for a senior role should score low — don't inflate.

## BULLET-WRITING QUALITY BAR

Every experience bullet must:
- Start with a strong action verb (Led, Built, Designed, Implemented, Delivered, Scaled, Reduced, Grew, etc.) — never start with "Responsible for" or "Worked on"
- Be 1-2 lines max
- Include a measurable outcome where the original profile included one (%, ₹ amount, team size, time saved, etc.)
- Weave in JD keywords naturally where truthful

## EDGE CASES

- If user profile is thin (fresher with only 1 project): still produce a resume. Lead with education, then projects. Skills section becomes more important.
- If user profile doesn't match JD at all (e.g., marketing background, JD for backend engineer): be honest. Write a clean resume highlighting transferable skills. ats_score will be low (and should be).
- If user profile is missing sections entirely (e.g., no projects): omit that section from the JSON. Don't include empty arrays.

## LENGTH

Total resume content should fit on one A4 page — roughly 450-550 words across all sections combined. Err shorter, not longer.

## STRICT OUTPUT RULE

Return ONLY the JSON object. No preamble like "Here is the resume". No closing remarks. No markdown code fences. If you cannot produce valid JSON, something is wrong — stop and retry your reasoning.`;


function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}
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
    const isCreator = session.user.email === CREATOR_EMAIL;

    // Credit gating
    let isFreeRegen = false;
    if (regen_of_resume_id) {
      isFreeRegen = await canGenerateFreeRegen(userId, regen_of_resume_id);
    }

    if (!isCreator && !isFreeRegen) {
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
      resumeJson = JSON.parse(extractJson(rawText));
    } catch {
      // JSON parse failure — do NOT consume credit
      console.error("Failed to parse AI response:", rawText.slice(0, 500));
      return NextResponse.json(
        { error: "We hit a glitch drafting your resume. Please try once more." },
        { status: 500 }
      );
    }

    // Consume credit only after a successful parse
    if (!isCreator && !isFreeRegen) {
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
