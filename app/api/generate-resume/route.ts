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
  jd_keywords: z.array(z.string()).optional(),
  template: z.string().optional(),
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

You will receive ONE JSON payload with these labelled fields:
- JD_TEXT: the raw target job description
- USER_CURATED_KEYWORDS: keywords the candidate has personally reviewed and confirmed are important. Treat this as ground truth.
- INTERSECTION_SKILLS: skills present in BOTH user profile AND curated keywords. Highest-priority injects.
- JD_ONLY_SKILLS: keywords the JD/curated list mentions but the user profile does NOT contain. NEVER claim these as the user\u2019s. Use them only in missing_keywords.
- PROFILE_EXTRA_SKILLS: skills the user has but were not curated for this JD. Use only if they support a bullet truthfully.
- TEMPLATE: visual template hint (modern | compact | executive). Affects bullet density only; never add visual flourish in text.
- USER_PROFILE: personal info, education, experience, skills, projects, target roles.

Produce ONE JSON object representing a polished, ATS-pass-ready resume tailored to the JD, using only truthful information from USER_PROFILE.

## STEP 0 \u2014 TRUST THE USER\u2019S CURATED KEYWORDS (highest priority)
1. Every keyword in USER_CURATED_KEYWORDS that the user truthfully has experience with MUST appear verbatim in the resume \u2014 in skills, in at least one bullet, or in the summary.
2. Keywords present in JD_TEXT but absent from USER_CURATED_KEYWORDS are Tier-2. Use only if they truthfully strengthen a bullet.
3. If a keyword is in JD_TEXT but explicitly NOT in USER_CURATED_KEYWORDS, the user has signalled it is irrelevant. Do NOT inject it.
4. INTERSECTION_SKILLS \u2192 must-injects. JD_ONLY_SKILLS \u2192 missing_keywords output only.

## STEP 1 \u2014 ANALYSE THE JD (internal reasoning, not in output)
Identify: (a) top 3 hard skills, (b) top 3 soft skills, (c) seniority level, (d) industry domain, (e) the exact job title verbatim, (f) build TARGET_KEYWORDS = USER_CURATED_KEYWORDS first, plus up to 5 extra high-frequency JD keywords if room remains.

## ATS MACHINE-PARSEABILITY RULES (non-negotiable \u2014 these are what ATS bots actually scan for)
Real ATS parsers (Workday, Greenhouse, iCIMS, Lever, Naukri RMS, Taleo) are unforgiving. Obey ALL:
1. PLAIN TEXT ONLY. No emojis. No unicode symbols. No \u2605 \u2713 \u2192 \u2022 \u25CF. Use ASCII hyphen "-" instead of en-dash or em-dash.
2. LITERAL KEYWORD PRESERVATION. If JD says "Performance Marketing", write "Performance Marketing" \u2014 never paraphrase. ATS does literal substring matching, not semantics.
3. EXPAND ACRONYMS ONCE. First use: "Search Engine Optimisation (SEO)". After that, the acronym is fine. This double-matches the parser.
4. DATE FORMAT MMM YYYY. e.g., "Jun 2023" or "Jun 2023 - Present". Never "06/2023" or "June, 23".
5. SINGLE LINEAR FLOW. No columns, tables, or text-boxes thinking. The renderer is single-column.
6. STANDARD SECTION HEADERS only: Summary, Experience, Skills, Education, Projects.
7. REVERSE-CHRONOLOGICAL. Newest experience first; newest education first.
8. NO HEADERS/FOOTERS/SIDEBARS. Contact info goes only in structured profile fields.
9. NUMBERS AS DIGITS. "5 years", "managed 12 stakeholders" \u2014 not "five" or "twelve".
10. NO BIAS-TRIGGERING FIELDS. Never include date of birth, marital status, photo, religion, caste.

## CORE PRINCIPLES
1. NEVER FABRICATE. Rephrase, reorganise, emphasise \u2014 never invent a skill, job, project, or achievement.
2. TRUTH-PRESERVING TAILORING. Reword only when the underlying meaning stays true.
3. INDIAN MARKET FIT. Indian English spelling; \u20B9 for salaries; recognise Indian companies (Reliance, Infosys, TCS, Flipkart, Wipro, HCL, Zomato) and qualifications (B.Tech, B.E., MBA, CA, M.Com, BCA, MCA, B.Sc) as-is.
4. JD-DRIVEN INJECTION. Exact JD job title verbatim in summary sentence 1. Top 3 hard skills appear in skills AND in at least one bullet each. Top 2 soft skills woven into summary prose (not listed).

## SECTION ORDER
- FRESHER (0-1 yr or no experience): section_order = ["summary", "education", "projects", "skills", "experience"]
- EXPERIENCED (2+ yrs): section_order = ["summary", "experience", "skills", "education", "projects"]

## BULLET FORMULA
[Strong action verb] + [scope] + [tool / target keyword] + [quantified outcome].
Example: "Led a 4-person squad to migrate billing service to AWS Lambda, cutting infra cost by 38% within two quarters."
Reject any bullet that:
- Starts with "Responsible for", "Worked on", "Helped", "Assisted", "Supported"
- Is longer than 2 lines
- Has zero quantified outcome AND the profile had a number available
- Contains zero TARGET_KEYWORDS
Strong verbs: Led, Built, Designed, Implemented, Delivered, Scaled, Reduced, Grew, Launched, Optimised, Automated, Architected, Negotiated, Managed, Developed, Deployed, Analysed, Streamlined.

## ATS SCORING (0-100, integer)
- KEYWORD MATCH (40 pts): from USER_CURATED_KEYWORDS, count how many appear LITERALLY in the resume. Score = (matched / total_curated) * 40. If total_curated == 0, fall back to top-10 JD keywords.
- EXPERIENCE RELEVANCE (30 pts): rate each experience 0/1/2 vs JD. Score = (sum / (num*2)) * 30. Freshers: rate projects instead.
- SKILLS OVERLAP (20 pts): min(jd_skills_matched / 8, 1.0) * 20.
- STRUCTURE (10 pts): action-verb starts (+3), \u22652 quantified bullets (+4), exact JD title in summary (+3).
Most resumes 55-80. >85 should be rare. Inflate nothing.

## EDGE CASES
- Fresher with 1 project: lead with education, then projects. Skills section grows in importance.
- Profile mismatch: be honest, low ats_score (30-50), populate growth_note.
- Missing sections: omit from JSON; never emit empty arrays.
- Career gap: list duration accurately; never fabricate freelance.

## LENGTH
~450-550 words across all sections. One A4 page. Err shorter.

## OUTPUT \u2014 RETURN ONLY THIS JSON
No preamble. No closing remarks. No markdown fences. If you cannot produce valid JSON, retry your reasoning.

{
  "section_order": ["summary", "experience", "skills", "education", "projects"],
  "summary": "2-3 sentences. Sentence 1 contains the exact JD job title verbatim. Mention experience length, top 2 soft skills woven in, career intent.",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "duration": "MMM YYYY - MMM YYYY or MMM YYYY - Present",
      "location": "string (optional)",
      "bullets": ["3-5 bullets following the BULLET FORMULA"]
    }
  ],
  "skills": ["ordered: USER_CURATED_KEYWORDS the user truthfully has first, then PROFILE_EXTRA_SKILLS, max 15"],
  "education": [
    { "institution": "string", "degree": "string", "year": "string", "location": "string (optional)", "gpa": "string (optional)" }
  ],
  "projects": [
    { "name": "string", "description": "1-2 lines with measurable outcome", "tech": ["relevant tech"] }
  ],
  "ats_score": 72,
  "matched_keywords": ["literal keywords from USER_CURATED_KEYWORDS that appear in the resume"],
  "missing_keywords": ["up to 5 keywords from JD_ONLY_SKILLS the user could truthfully add"],
  "tailored_role": "the exact job title verbatim from the JD",
  "profile_improvement_tips": [
    "Specific actionable tip 1",
    "Specific actionable tip 2",
    "Specific actionable tip 3"
  ],
  "growth_note": "null if good match; otherwise 1 honest sentence about fit."
}`;

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9+#.\- ]/g, "").trim();
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
    const { jd_text, jd_url, jd_keywords, template, user_profile, regen_of_resume_id } = parsed.data;
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
    // Build the labelled payload that the upgraded SYSTEM_PROMPT expects.
    const curated = (jd_keywords ?? []).map(k => k.trim()).filter(Boolean);
    const profileSkills = (p.skills ?? []).map(s => s.trim()).filter(Boolean);
    const profileSkillsNorm = new Set(profileSkills.map(norm));
    const curatedNorm = new Set(curated.map(norm));
    const intersection = curated.filter(k => profileSkillsNorm.has(norm(k)));
    const jdOnly = curated.filter(k => !profileSkillsNorm.has(norm(k)));
    const profileExtras = profileSkills.filter(s => !curatedNorm.has(norm(s)));
    const userPayload = {
      JD_TEXT: jd_text,
      JD_URL: jd_url || null,
      USER_CURATED_KEYWORDS: curated,
      INTERSECTION_SKILLS: intersection,
      JD_ONLY_SKILLS: jdOnly,
      PROFILE_EXTRA_SKILLS: profileExtras,
      TEMPLATE: template || "modern",
      USER_PROFILE: user_profile,
    };
    // Call Anthropic
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
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
      return NextResponse.json({ error: "Generation timed out - please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Resume generation failed. Please try again." }, { status: 500 });
  }
}
