import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canGenerateResume, canGenerateFreeRegen, consumeCredit } from "@/lib/plans";
import { getMissingFields, FIELD_LABEL } from "@/lib/profile-completeness";

export const maxDuration = 60;

const inputSchema = z.object({
  jd_text: z.string().min(100, "Job description too short (min 100 chars)"),
  jd_url: z.string().url().optional().or(z.literal("")),
  regen_of_resume_id: z.string().uuid().optional(),
  user_profile: z.object({
    full_name: z.string(),
    email: z.string().email("Please enter a valid email address"),
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

2. TRUTH-PRESERVING TAILORING: When rewording a bullet to match JD keywords, the underlying meaning must stay true.

3. INDIAN MARKET FIT:
   - Use Indian English conventions (spelling, idiom)
   - Use ₹ for salaries/budgets (not $ or €)
   - Recognize Indian company names as-is (Reliance, Infosys, TCS, Flipkart)
   - Recognize Indian qualifications (B.Tech, B.E., MBA, CA, M.Com)

4. JD-DRIVEN:
   - Extract 8-12 critical keywords from the JD
   - Rewrite experience bullets to naturally incorporate these keywords where the user actually did related work
   - Prioritize and reorder skills section so JD-matched skills appear first

## OUTPUT STRUCTURE (return ONLY this JSON, no preamble, no markdown fences)
{
  "summary": "2-3 sentences positioning the user for this specific role.",
  "experience": [{"company": "string", "role": "string", "duration": "string", "location": "string", "bullets": ["3-5 bullets per role"]}],
  "skills": ["ordered array: JD-matched skills first, max 15"],
  "education": [{"institution": "string", "degree": "string", "year": "string", "location": "string", "gpa": "string"}],
  "projects": [{"name": "string", "description": "1-2 lines", "tech": ["technologies"]}],
  "ats_score": "integer 0-100",
  "matched_keywords": ["keywords from JD that appear in this resume"],
  "missing_keywords": ["up to 5 JD keywords the user should consider adding"],
  "tailored_role": "the job title this resume is targeting"
}

## STRICT OUTPUT RULE
Return ONLY the JSON object. No preamble. No closing remarks. No markdown code fences.`;

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

    // ── Profile completeness guard (server-side, aligned with client) ──────
    // Build a ProfileForCompleteness-shaped object from the incoming payload
    const profileForCheck = {
      full_name: user_profile.full_name,
      email: user_profile.email,
      target_roles: user_profile.target_roles ?? [],
      profile_data: {
        experience: user_profile.experience ?? [],
        education: user_profile.education ?? [],
        projects: user_profile.projects ?? [],
      },
    };
    const missingFields = getMissingFields(profileForCheck);
    if (missingFields.length > 0) {
      const list = missingFields.map((f) => FIELD_LABEL[f] ?? f).join(", ");
      return NextResponse.json(
        {
          error: `Your profile is missing some required information: ${list}. Please complete your profile and try again.`,
          missing: missingFields,
        },
        { status: 422 }
      );
    }

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
      resumeJson = JSON.parse(extractJson(rawText));
    } catch {
      console.error("Failed to parse AI response:", rawText.slice(0, 500));
      return NextResponse.json(
        { error: "We hit a glitch drafting your resume. Please try once more." },
        { status: 500 }
      );
    }

    // Consume credit only after a successful parse
    if (!isFreeRegen) {
      const credited = await consumeCredit(userId);
      if (!credited) {
        return NextResponse.json(
          { error: "PAYMENT_REQUIRED", reason: "CREDITS_EXHAUSTED", upgrade_url: "/pricing" },
          { status: 402 }
        );
      }
    }

    return NextResponse.json({ resume_json: resumeJson, is_free_regen: isFreeRegen });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Generate resume error:", msg);
    if (msg.includes("401") || msg.includes("authentication") || msg.includes("API key")) {
      return NextResponse.json({ error: "Configuration error. Please contact support." }, { status: 500 });
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      return NextResponse.json({ error: "Generation timed out — please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Resume generation failed. Please try again." }, { status: 500 });
  }
}
