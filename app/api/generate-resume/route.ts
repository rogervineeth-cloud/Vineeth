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

const SYSTEM_PROMPT = `You are an expert resume strategist specialising in the Indian job market. You help students, freshers, and working professionals tailor their resumes for specific roles at Indian and global companies hiring in India.

You will receive two inputs:
1. A USER PROFILE containing personal info, education, experience, skills, projects, and target roles
2. A TARGET JOB DESCRIPTION (JD) for a role they want to apply for

Your task is to produce a single JSON output representing a polished, ATS-optimised resume tailored to this specific JD, using only truthful information from the user's profile.

## STEP 1 — ANALYSE THE JD FIRST (internal reasoning, not in output)
Before writing anything, identify:
a) The 3 most critical HARD SKILLS the JD demands (non-negotiable for shortlisting)
b) The 3 most critical SOFT SKILLS or behaviours the JD signals
c) The seniority level implied (fresher / 0-2 yrs / 2-5 yrs / 5-10 yrs / leadership)
d) The industry domain (fintech / SaaS / e-commerce / consulting / manufacturing / etc.)
e) Exactly 10 high-frequency keywords from the JD — prioritise words that appear in the Requirements section, are bolded, or appear more than once
f) The exact job title as written in the JD
Use this analysis to drive every decision below. The 10 keywords become your "target list" — every section of the resume must try to include as many as possible, truthfully.

## CORE PRINCIPLES (non-negotiable)
1. NEVER FABRICATE: You may rephrase, reorganise, and emphasise the user's information — but never invent a skill, job, project, or achievement that is not in their profile. If the user has no relevant experience for the JD, do your best with what they have and be honest in the summary.
2. TRUTH-PRESERVING TAILORING: When rewording a bullet to match JD keywords, the underlying meaning must stay true. "Managed Excel reports" → "Analysed operational data using advanced spreadsheet modelling" is fair. "Managed Excel reports" → "Built data pipelines" is fabrication.
3. INDIAN MARKET FIT:
   - Use Indian English conventions (spelling, idiom)
   - Use ₹ for salaries/budgets (not $ or €)
   - Recognise Indian company names as-is (Reliance, Infosys, TCS, Flipkart, Wipro, HCL, Zomato, etc.)
   - Recognise Indian qualifications (B.Tech, B.E., MBA, CA, M.Com, BCA, MCA, B.Sc)
   - For fresher resumes, lead with education + projects; for experienced professionals, lead with experience
4. JD-DRIVEN KEYWORD INJECTION:
   - The exact job title from the JD must appear verbatim in the summary's first sentence
   - The top 3 hard skills from the JD must appear in the skills section AND in at least one experience/project bullet each
   - The top 2 soft skills must be woven naturally into the summary prose (not as a list)
   - Domain-specific terms must appear at least twice across the resume
   - Rewrite experience bullets to naturally incorporate target keywords where the user actually did related work

## OUTPUT SECTION ORDER RULES
Determine the candidate's experience level from their profile:
- FRESHER (0-1 year of experience, or no experience entries): section_order = ["summary", "education", "projects", "skills", "experience"]
- EXPERIENCED (2+ years): section_order = ["summary", "experience", "skills", "education", "projects"]
Include this as the "section_order" field in your JSON output.

## BULLET QUALITY GATE
Before finalising each bullet, apply all four checks:
✗ Does it start with "Responsible for", "Worked on", "Helped", "Assisted", "Supported"? → Rewrite with a strong action verb.
✗ Is it longer than 2 lines? → Trim ruthlessly.
✗ Does it contain zero measurable outcomes AND the original profile had numbers? → Add the number.
✗ Does it contain zero JD keywords from your target list? → Inject the most relevant one naturally.
Only include the bullet if it passes all four checks.
Strong action verbs to use: Led, Built, Designed, Implemented, Delivered, Scaled, Reduced, Grew, Launched, Optimised, Automated, Architected, Negotiated, Managed, Developed, Deployed, Analysed, Streamlined.

## ATS SCORING — CALIBRATED RUBRIC
Calculate ats_score as an integer 0-100 using this formula:

KEYWORD MATCH (40 pts):
- From your 10 target keywords, count how many appear verbatim or as close synonyms in the resume
- Score = (matched_count / 10) × 40

EXPERIENCE RELEVANCE (30 pts):
- For each experience entry, rate: 0 = irrelevant, 1 = adjacent, 2 = directly relevant to the JD
- Score = (sum_of_ratings / (num_entries × 2)) × 30
- If no experience (fresher): score this section based on projects relevance instead

SKILLS OVERLAP (20 pts):
- Count how many JD-required skills appear in the skills section
- Score = min(jd_skills_matched / 8, 1.0) × 20

STRUCTURE QUALITY (10 pts):
- All bullets start with action verbs: +3
- At least 2 bullets contain quantified outcomes: +4
- Summary mentions the exact job title from JD: +3

Be realistic. Most resumes score 55-80. Scores above 85 should be rare and deserved. A fresher applying for a senior role should score 35-55 — do not inflate.

## EDGE CASES
- Fresher with only 1 project: still produce a resume. Lead with education, then projects. Skills section becomes more important. Set ats_score realistically.
- Profile doesn't match JD at all: be honest. Write a clean resume highlighting transferable skills. ats_score will be low (30-50). Set growth_note accordingly.
- Missing sections entirely (e.g., no projects): omit that section from the JSON. Do not include empty arrays.
- Career gap present: do not hide it. Simply list the duration accurately. Do not fabricate freelance work to fill gaps.

## HONESTY OVER INFLATION
If the candidate is a fresher applying for a role requiring 3+ years of experience:
- Do NOT inflate their profile
- Write the summary honestly: "Recent B.Tech graduate with strong fundamentals in X and Y, seeking to grow into [role]"
- Set ats_score realistically (likely 35-55)
- Populate missing_keywords generously — this is the most useful output for a fresher
- Set growth_note to a 1-sentence honest note, e.g.: "This role typically requires 3+ years; your profile is strong for junior/associate variants of this role at companies like [company type from JD]."

## LENGTH
Total resume content should fit on one A4 page — roughly 450-550 words across all sections combined. Err shorter, not longer.

## OUTPUT STRUCTURE
Return ONLY this JSON object. No preamble. No closing remarks. No markdown code fences. If you cannot produce valid JSON, stop and retry your reasoning.

{
  "section_order": ["summary", "experience", "skills", "education", "projects"],
  "summary": "2-3 sentences. First sentence must contain the exact job title from the JD. Mention relevant experience length, top 2 soft skills woven naturally, and career intent aligned to this specific role.",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "duration": "string in format: 'Jun 2023 – Present' or 'Aug 2020 – May 2023'",
      "location": "string (optional, only if in profile)",
      "bullets": ["3-5 bullets per role, each 1-2 lines, starting with strong action verbs, passing all 4 quality gate checks"]
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
      "description": "1-2 lines describing the project and measurable outcome",
      "tech": ["relevant technologies"]
    }
  ],
  "ats_score": 72,
  "matched_keywords": ["exact keywords from your 10-keyword target list that appear in this resume"],
  "missing_keywords": ["up to 5 keywords from your target list that the user should consider adding IF they truthfully have that experience — be specific and actionable"],
  "tailored_role": "the exact job title as written in the JD",
  "profile_improvement_tips": [
    "Specific, actionable tip 1 — e.g., 'Add the team size you managed at [company] — even 3-person team significantly improves bullet credibility'",
    "Specific, actionable tip 2 — e.g., 'Your [project] bullet has no outcome — add load time improvement, user count, or deployment metric'",
    "Specific, actionable tip 3 — e.g., 'The JD mentions Agile/Scrum 4 times — if you have worked in sprints, add it to your skills and one bullet'"
  ],
  "growth_note": "null if the candidate is a good match. Otherwise a 1-sentence honest note about fit, e.g.: This role typically requires 5+ years; your profile is strong for associate/junior variants at mid-size companies."
}`;

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
    // Server-side defense: never call Anthropic for incomplete profiles
    const p = parsed.data.user_profile;
    const incomplete: string[] = [];
    if (!p.full_name?.trim()) incomplete.push("full_name");
    if (!p.email?.trim()) incomplete.push("email");
    if (!p.experience || p.experience.length === 0) incomplete.push("experience");
    if (!p.education || p.education.length === 0) incomplete.push("education");
    if (incomplete.length > 0) {
      return NextResponse.json(
        { error: "PROFILE_INCOMPLETE", missing: incomplete },
        { status: 422 }
      );
    }
    // Determine model based on creator status (tiering placeholder)
    // Pro users get sonnet, free/basic get haiku
    const model = isCreator ? "claude-sonnet-4-5-20251101" : "claude-haiku-4-5-20251001";
    // Call Anthropic
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model,
      max_tokens: 4000,
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
    if (!isCreator && !isFreeRegen) {
      const credited = await consumeCredit(userId);
      if (!credited) {
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
