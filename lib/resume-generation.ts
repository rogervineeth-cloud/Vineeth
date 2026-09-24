// The resume generation pipeline, minus everything request-specific.
//
// app/api/generate-resume/route.ts owns auth, credits, lineage and the HTTP
// contract. Everything between "validated input" and "resume JSON ready to
// return" lives here so the resume-quality eval harness
// (evals/resume-quality) runs the IDENTICAL prompt, request, parse,
// sanitiser and normaliser — with no auth, no credits and no database.

import type Anthropic from "@anthropic-ai/sdk";
import { GENERATION_TEMPERATURE } from "@/lib/models";
import { detectTechSkills, TECH_SKILLS } from "@/lib/jd-keywords";
import { computeFacts, yearsProblems, type CandidateFacts } from "@/lib/profile-facts";
import { Evidence, novelDetail } from "@/lib/detail-evidence";

const KNOWN_SKILLS = new Set(TECH_SKILLS.map((s) => s.name));
import {
  sanitiseGeneratedResume,
  normaliseGeneratedResume,
  type ResumeShape,
} from "@/lib/sanitise-resume";

export const SYSTEM_PROMPT = `You are an expert resume strategist specialising in the Indian job market. You help students, freshers, and working professionals tailor their resumes for specific roles at Indian and global companies hiring in India.

You will receive ONE JSON payload with these labelled fields:
- JD_TEXT: the raw target job description
- USER_CURATED_KEYWORDS: keywords the candidate has personally reviewed and confirmed are important. Treat this as ground truth.
- INTERSECTION_SKILLS: skills present in BOTH user profile AND curated keywords. Highest-priority injects.
- JD_ONLY_SKILLS: keywords the JD/curated list mentions but the user profile does NOT contain. NEVER claim these as the user\u2019s. Use them only in missing_keywords.
- PROFILE_EXTRA_SKILLS: skills the user has but were not curated for this JD. Use only if they support a bullet truthfully.
- TEMPLATE: visual template hint (modern | compact | executive). Affects bullet density only; never add visual flourish in text.
- USER_PROFILE: personal info, education, experience, skills, projects, target roles.
- CANDIDATE_FACTS: computed from USER_PROFILE durations \u2014 professional (non-internship) years, internship months, current title, and summary_opening (the sentence that states who the candidate is). Use these numbers exactly; never compute your own.

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

## ANTI-FABRICATION (HARD RULES \u2014 OVERRIDE ALL OTHER INSTRUCTIONS)
A. Every company name, role title, employment duration, and education institution in the OUTPUT must appear VERBATIM (case-insensitive, whitespace-tolerant) in USER_PROFILE. If a company is not in USER_PROFILE.experience, you MUST NOT emit it.
B. NEVER emit placeholder companies such as "Previous Organization", "Company A", "Employer", "Confidential", "N/A", "Various", "Self", "Freelance" unless that exact string appears in USER_PROFILE.
C. If USER_PROFILE.experience is empty, you MUST omit the "experience" array entirely. Do not invent freelance work, internships, or "previous roles" to fill the gap. Lead with education and projects instead.
D. If USER_PROFILE indicates a fresher (graduation_year within the last 1 year, or experience length 0), set section_order to the FRESHER order and set ats_score conservatively (cap at 65 unless projects strongly match).
E. Bullets must paraphrase ONLY the bullets supplied in USER_PROFILE.experience[i].bullets. You may sharpen the verb, use a TARGET_KEYWORD only where that bullet already describes it (rule J), and add a metric ONLY if a number is already present in the user-supplied bullet. You may NOT invent new metrics, team sizes, percentages, currency amounts, or outcomes.
F. Durations must match USER_PROFILE.experience[i].duration character-for-character (after normalising to "MMM YYYY - MMM YYYY"). Do not extend, shorten, or back-date employment.
G. If you are tempted to fabricate anything to make the resume look stronger, instead reduce ats_score and write an honest growth_note.
H. SKILLS ARE EVIDENCE-ONLY. The "skills" array, "matched_keywords", the summary, every bullet and every project description may name a skill, tool or practice ONLY if USER_PROFILE shows it (its skills list, a role, a bullet, or a project). JD_ONLY_SKILLS must never appear in any of them \u2014 only in missing_keywords. Never add a skill, technology or practice (e.g. "distributed systems", "design patterns", "algorithms", "code reviews", "object-oriented design") to a bullet or project that the source does not already describe.
I. TITLE AND LEVEL. Refer to the candidate by their own most recent role title from USER_PROFILE.experience (or as a graduate/fresher if they have none). Name the JD job title only as the role being sought ("seeking the <title> role"). Never write the JD title or level as the candidate's current title, and state years of experience exactly as CANDIDATE_FACTS.professional_years gives them (rounded down, e.g. "3+ years") \u2014 never more, never fewer; internships are not years of professional experience.
J. REPHRASE, DON'T ELABORATE. A bullet or project description may reword ONLY what its own source says. Never add a tool, method, mechanism, component, scale, quality or outcome the source does not state \u2014 e.g. never turn "Automated nightly reconciliation reports" into "...using batch jobs", never add "optimising queries", "improving resilience", "ensuring reliability", "enabling faster delivery". If a source bullet cannot be strengthened truthfully, keep it as written.
K. ADVICE IS EVIDENCE-ONLY TOO. growth_note and profile_improvement_tips may credit the candidate ("you have", "your role demonstrates", "strong ...") only with skills USER_PROFILE shows, and may state their experience only as CANDIDATE_FACTS gives it. Never tell the candidate to add, highlight or mention on the resume a skill, practice or achievement USER_PROFILE does not show \u2014 recommend gaining it first.

## CORE PRINCIPLES
1. NEVER FABRICATE. Rephrase, reorganise, emphasise \u2014 never invent a skill, job, project, or achievement.
2. TRUTH-PRESERVING TAILORING. Reword only when the underlying meaning stays true.
3. INDIAN MARKET FIT. Indian English spelling; \u20B9 for salaries; recognise Indian companies (Reliance, Infosys, TCS, Flipkart, Wipro, HCL, Zomato) and qualifications (B.Tech, B.E., MBA, CA, M.Com, BCA, MCA, B.Sc) as-is.
4. JD-DRIVEN INJECTION. Name the exact JD job title in the summary as the role being sought (rule I). Of the top 3 hard skills, those the candidate truthfully has (INTERSECTION_SKILLS) appear in skills, and in a bullet only where that bullet's source already describes them (rule J); the rest go only to missing_keywords (rule H). Do not claim soft skills or qualities ("strong problem-solver", "scalable", "proficient") the profile does not show.

## SECTION ORDER
- FRESHER (0-1 yr or no experience): section_order = ["summary", "education", "projects", "skills", "experience"]
- EXPERIENCED (2+ yrs): section_order = ["summary", "experience", "skills", "education", "projects"]

## BULLET FORMULA
[Strong action verb] + [scope] + [tool / target keyword] + [quantified outcome] \u2014 each part taken from the source bullet, never added (rule J).
Example: "Led a 4-person squad to migrate billing service to AWS Lambda, cutting infra cost by 38% within two quarters."
Reject any bullet that:
- Starts with "Responsible for", "Worked on", "Helped", "Assisted", "Supported"
- Is longer than 2 lines
- Has zero quantified outcome AND the profile had a number available
- Adds a skill, tool, method, component or outcome that the source bullet does not contain (rules H and J)
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
- Seniority or domain gap: if the JD's stated minimum professional experience exceeds the candidate's non-internship experience, or the role is outside the candidate's domain, ats_score must not exceed 55 and growth_note must explain the gap.
- Advice: growth_note and profile_improvement_tips recommend GAINING missing skills; never credit the candidate with, or tell them to add to the resume, a skill they do not have (rule K).
- Missing sections: omit from JSON; never emit empty arrays.
- Career gap: list duration accurately; never fabricate freelance.

## LENGTH
~450-550 words across all sections. One A4 page. Err shorter.

## OUTPUT \u2014 RETURN ONLY THIS JSON
No preamble. No closing remarks. No markdown fences. If you cannot produce valid JSON, retry your reasoning.

{
  "section_order": ["summary", "experience", "skills", "education", "projects"],
  "summary": "2-3 sentences. Sentence 1 opens with who the candidate is, as in CANDIDATE_FACTS.summary_opening (their own title and exact professional years, or their degree if they have no employment) \u2014 never with a skill list or 'Proficient in'. Name the exact JD job title only as the role being sought. Every other detail must come from USER_PROFILE.",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "duration": "MMM YYYY - MMM YYYY or MMM YYYY - Present",
      "location": "string (optional)",
      "bullets": ["3-5 bullets following the BULLET FORMULA"]
    }
  ],
  "skills": ["only skills evidenced in USER_PROFILE: INTERSECTION_SKILLS first, then PROFILE_EXTRA_SKILLS, max 15"],
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

export function extractJson(raw: string): string {
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

export type GenerationProfile = {
  summary?: string;
  skills?: string[];
  target_roles?: string[];
  experience?: { company: string; role: string; duration: string; location: string; bullets: string[] }[];
  education?: { institution: string; degree: string; year: string; location: string; cgpa?: string }[];
  projects?: { name: string; description: string; tech: string[] }[];
  [key: string]: unknown;
};

export type GenerationInput = {
  jd_text: string;
  jd_url?: string;
  jd_keywords?: string[];
  template?: string;
  user_profile: GenerationProfile;
  /** Clock for CANDIDATE_FACTS ("Present" durations); tests pin it. */
  now?: Date;
};

/**
 * Every place in the profile a skill can be evidenced: the skills list, but
 * also role titles, experience bullets, project names, descriptions and tech.
 *
 * NOT the summary: summaries carry aspiration ("eager to learn Kubernetes",
 * "targeting distributed systems roles"), and reading those as evidence would
 * tell the model to claim a skill the candidate does not have.
 */
function profileEvidence(p: GenerationProfile): string {
  const parts: string[] = [...(p.skills ?? [])];
  for (const e of p.experience ?? []) parts.push(e.role, ...e.bullets);
  for (const pr of p.projects ?? []) parts.push(pr.name, pr.description, ...pr.tech);
  return parts.join("\n");
}

/**
 * The labelled payload the SYSTEM_PROMPT expects.
 *
 * INTERSECTION_SKILLS (must include) vs JD_ONLY_SKILLS (never claim) decides
 * what the model is allowed to say, so it must reflect what the candidate
 * actually has. It used to compare curated keywords against the skills list
 * by exact normalised string, so a candidate whose profile says "ReactJS",
 * "RESTful APIs" or "Data Structures and Algorithms" — or who shows code
 * reviews only in a bullet — was told NEVER to claim React, REST API, Data
 * Structures or Code Review, and those skills were then listed back to them
 * as "missing". Curated keywords are canonical TECH_SKILLS names, so the
 * profile is read with the same alias-aware matcher (lib/jd-keywords), over
 * every field that can evidence a skill. The exact-string check remains for
 * keywords the candidate typed in themselves.
 */
export function buildGenerationPayload(input: GenerationInput) {
  const p = input.user_profile;
  const facts = computeFacts(p, input.now ?? new Date());
  const curated = (input.jd_keywords ?? []).map(k => k.trim()).filter(Boolean);
  const profileSkills = (p.skills ?? []).map(s => s.trim()).filter(Boolean);
  const profileSkillsNorm = new Set(profileSkills.map(norm));
  const evidenceText = profileEvidence(p);
  const evidenced = new Set(detectTechSkills(evidenceText));
  const evidenceNorm = ` ${norm(evidenceText).replace(/\s+/g, " ")} `;
  const has = (k: string) =>
    evidenced.has(k) ||
    profileSkillsNorm.has(norm(k)) ||
    // A keyword the candidate typed that is not a known skill ("Razorpay"),
    // evidenced verbatim. Known skills never take this path: they go only
    // through detectTechSkills and its English-word guards, or "express
    // interest" / "excel at" in a bullet would license Express and Excel.
    (!KNOWN_SKILLS.has(k) && norm(k).length >= 3 && evidenceNorm.includes(` ${norm(k)} `));
  const curatedSet = new Set(curated);
  const curatedNorm = new Set(curated.map(norm));
  const intersection = curated.filter(has);
  const jdOnly = curated.filter(k => !has(k));
  // A profile skill already represented by a curated keyword ("ReactJS" when
  // "React" is curated) is not an extra.
  const profileExtras = profileSkills.filter(s => {
    if (curatedNorm.has(norm(s))) return false;
    const canon = detectTechSkills(s);
    return !(canon.length > 0 && canon.every(c => curatedSet.has(c)));
  });
  return {
    JD_TEXT: input.jd_text,
    JD_URL: input.jd_url || null,
    USER_CURATED_KEYWORDS: curated,
    INTERSECTION_SKILLS: intersection,
    JD_ONLY_SKILLS: jdOnly,
    PROFILE_EXTRA_SKILLS: profileExtras,
    CANDIDATE_FACTS: {
      professional_years: facts.professional_years,
      internship_months: facts.internship_months,
      current_title: facts.current_title,
      employer_years: facts.employer_months.map((e) => ({ company: e.company, years: Math.floor((e.months / 12) * 10) / 10 })),
      summary_opening: facts.identity,
    },
    TEMPLATE: input.template || "modern",
    USER_PROFILE: input.user_profile,
  };
}

export type GenerationPayload = ReturnType<typeof buildGenerationPayload>;

/** The exact Messages API request production sends. */
export function buildModelRequest(model: string, payload: GenerationPayload) {
  return {
    model,
    max_tokens: 4000,
    // Structured extraction against a fixed JSON contract — not creative
    // writing. Sampling variance here surfaces as invented detail and
    // inconsistent formatting.
    temperature: GENERATION_TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user" as const, content: JSON.stringify(payload) },
      // Prefill the opening brace so the model cannot preamble its way into
      // unparseable output ("Here is the resume: ```json ...").
      { role: "assistant" as const, content: "{" },
    ],
  };
}

/**
 * Parse the model's reply. The assistant turn was prefilled with "{", so the
 * completion continues from there and the opening brace is not echoed back.
 * Re-add it before parsing. (extractJson also looks for the first "{", so
 * without this the object would be truncated at the first nested one.)
 * Returns null when the reply is not valid JSON.
 */
export function parseModelReply(message: Pick<Anthropic.Message, "content">): { json: unknown; rawText: string } | null {
  const first = message.content[0];
  const completion = first && first.type === "text" ? first.text : "";
  const rawText = completion.trimStart().startsWith("{") ? completion : `{${completion}`;
  try {
    return { json: JSON.parse(extractJson(rawText)), rawText };
  } catch {
    return null;
  }
}

/**
 * Defence in depth after the model: scrub fabricated companies, placeholder
 * rows and invented metrics (sanitiser), then enforce the output contract
 * (normaliser). The WHOLE profile is passed, not just experience — education
 * placeholders and numeric grounding both need it.
 */
export function postProcessResume(resumeJson: unknown, profile: GenerationProfile, opts: { now?: Date } = {}) {
  const sanitised = sanitiseGeneratedResume(resumeJson as ResumeShape, {
    summary: profile.summary,
    experience: profile.experience ?? [],
    education: profile.education ?? [],
    projects: profile.projects ?? [],
    skills: profile.skills ?? [],
  });
  const evidenced = enforceSkillEvidence(sanitised.resume, profile);
  const detailed = enforceDetailEvidence(evidenced.resume, profile);
  const facts = computeFacts(profile, opts.now ?? new Date());
  const summarised = enforceSummaryFacts(detailed.resume, profile, facts);
  const advised = enforceAdviceEvidence(summarised.resume, profile, facts);
  const normalised = normaliseGeneratedResume(
    advised.resume,
    (profile.target_roles?.[0] ?? "").trim()
  );
  return {
    resume: normalised.resume,
    warnings: [...sanitised.warnings, ...evidenced.warnings, ...detailed.warnings, ...summarised.warnings, ...advised.warnings],
    repaired: normalised.repaired,
    fatal: normalised.fatal,
  };
}

// ── Skill-evidence guard ───────────────────────────────────────────────────
//
// Resume-quality eval, live run on 11 scenarios (evals/resume-quality,
// results/before-live.md): EVERY generated resume claimed skills the profile
// never evidences — a fresher listed "Distributed Systems" and
// "Object-Oriented Design", a QA engineer was "proficient in" algorithms and
// distributed systems, a full-stack engineer's skills gained Python, C++ and
// GCP while the same resume listed them as missing. The prompt forbids this;
// the model does it anyway, because other prompt rules push JD keywords into
// every bullet. A recruiter who asks about any one of those claims ends the
// interview, so it is enforced here rather than requested.
//
// Scope: skills known to lib/jd-keywords (the same vocabulary that decides
// INTERSECTION vs JD_ONLY), plus literal checks for list entries. A known
// skill may appear in the output only if the profile evidences it — in its
// skills list, a role, a bullet, or a project. The candidate's own summary is
// not evidence (it carries aspiration), but reverting TO it is allowed: it is
// their own words.

// Separators become spaces, never nothing: deleting them glued adjacent
// evidence together ("JUnit\nJPA" -> "junitjpa", "JPA/Hibernate" ->
// "jpahibernate"), so the guard dropped the candidate's own JPA, Hibernate,
// Jenkins and JUnit in the first live after-run.
const WEAK_EVIDENCE_KEY = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Engineering practices a recruiter probes against the specific work claimed
 * ("tell me about the data structures you used here"). A rewritten bullet or
 * project may name one only if its OWN source does — profile-level evidence
 * is not enough for these. Languages and tools stay profile-level.
 */
const PRACTICE_SKILLS = new Set([
  "Data Structures", "Algorithms", "System Design", "Distributed Systems", "Object-Oriented Design",
  "Design Patterns", "Code Review", "Microservices", "Unit Testing", "Accessibility",
]);

function sourceSimilarity(a: string, b: string): number {
  const ta = new Set(WEAK_EVIDENCE_KEY(a).split(" ").filter((w) => w.length > 2));
  const tb = new Set(WEAK_EVIDENCE_KEY(b).split(" ").filter((w) => w.length > 2));
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.max(1, Math.min(ta.size, tb.size));
}

/**
 * detectTechSkills treats "-" as part of a word (so "go-to-market" is not Go),
 * which also hides "algorithm-optimised" or "microservice-based". For the
 * guard, read both the text and a hyphen-split copy; case rules still keep
 * "go to market" from reading as Go.
 */
function skillsMentioned(text: string): string[] {
  return [...new Set([...detectTechSkills(text), ...detectTechSkills(text.replace(/-/g, " "))])];
}

export function enforceSkillEvidence(resume: ResumeShape, profile: GenerationProfile) {
  const warnings: string[] = [];
  const evidenceText = profileEvidence(profile);
  const evidenced = new Set(skillsMentioned(evidenceText));
  const evidenceKey = ` ${WEAK_EVIDENCE_KEY(evidenceText)} `;
  const out = { ...resume } as ResumeShape & Record<string, unknown>;

  /** Known skills mentioned in `text` that the profile does not evidence. */
  const unsupportedIn = (text: string) => skillsMentioned(text).filter((k) => !evidenced.has(k));

  /** A list entry ("Distributed Systems", "Razorpay") is kept only if evidenced. */
  const listEntryOk = (entry: string) => {
    const known = skillsMentioned(entry);
    if (known.length > 0) return known.every((k) => evidenced.has(k));
    const key = WEAK_EVIDENCE_KEY(entry);
    return key.length > 0 && evidenceKey.includes(` ${key} `);
  };

  if (Array.isArray(out.skills)) {
    out.skills = out.skills.filter((s) => {
      const ok = typeof s === "string" && listEntryOk(s);
      if (!ok) warnings.push(`dropped_unsupported_skill:${s}`);
      return ok;
    });
  }

  for (const key of ["matched_keywords"] as const) {
    const list = out[key];
    if (Array.isArray(list)) out[key] = list.filter((k) => typeof k === "string" && listEntryOk(k));
  }
  // A candidate must never be told to add a skill they already have.
  if (Array.isArray(out.missing_keywords)) {
    out.missing_keywords = out.missing_keywords.filter((k) => {
      if (typeof k !== "string") return false;
      const known = detectTechSkills(k);
      return !(known.length > 0 && known.every((x) => evidenced.has(x)));
    });
  }

  // Bullets: a rewrite that introduces an unevidenced skill is reverted to the
  // candidate's own bullet it came from (best word overlap within the same
  // role), or dropped if no source bullet can be identified.
  if (Array.isArray(out.experience)) {
    out.experience = out.experience.map((exp) => {
      const src = (profile.experience ?? []).find(
        (p) => norm(p.company) === norm(exp.company ?? "") && norm(p.role) === norm(exp.role ?? "")
      ) ?? (profile.experience ?? []).find((p) => norm(p.company) === norm(exp.company ?? ""));
      const bullets = (exp.bullets ?? []).flatMap((b) => {
        const best = (src?.bullets ?? [])
          .map((sb) => ({ sb, score: sourceSimilarity(b, sb) }))
          .sort((x, y) => y.score - x.score)[0];
        const sourceText = best && best.score >= 0.3 ? best.sb : "";
        const sourcePractices = new Set(skillsMentioned(sourceText));
        const bad = [
          ...unsupportedIn(b),
          ...skillsMentioned(b).filter((k) => PRACTICE_SKILLS.has(k) && evidenced.has(k) && !sourcePractices.has(k)),
        ];
        if (bad.length === 0) return [b];
        if (best && best.score >= 0.3) {
          warnings.push(`reverted_bullet_unsupported_skill:${bad.join("|")}`);
          return [best.sb];
        }
        warnings.push(`dropped_bullet_unsupported_skill:${bad.join("|")}`);
        return [];
      });
      return { ...exp, bullets: [...new Set(bullets)] };
    });
  }

  if (Array.isArray(out.projects)) {
    out.projects = out.projects.map((pr) => {
      const src = (profile.projects ?? []).find((p) => {
        const a = norm(p.name), b = norm(pr.name ?? "");
        return a === b || a.startsWith(b) || b.startsWith(a);
      });
      let description = pr.description ?? "";
      const srcPractices = new Set(skillsMentioned(`${src?.description ?? ""}\n${(src?.tech ?? []).join("\n")}`));
      const bad = [
        ...unsupportedIn(description),
        ...skillsMentioned(description).filter((k) => PRACTICE_SKILLS.has(k) && evidenced.has(k) && !srcPractices.has(k)),
      ];
      if (bad.length > 0) {
        warnings.push(`reverted_project_description_unsupported_skill:${bad.join("|")}`);
        description = src?.description ?? "";
      }
      const tech = (pr.tech ?? []).filter((t) => {
        const ok = typeof t === "string" && listEntryOk(t);
        if (!ok) warnings.push(`dropped_unsupported_project_tech:${t}`);
        return ok;
      });
      return { ...pr, description, tech };
    });
  }

  // Summary: drop sentences that claim an unevidenced skill; if nothing is
  // left, fall back to the candidate's own summary.
  if (typeof out.summary === "string" && out.summary.trim()) {
    // Split only at ". X" — so "B.Tech", "Node.js" and "e.g." stay intact.
    const sentences = out.summary.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const kept = sentences.filter((sn) => {
      const bad = unsupportedIn(sn);
      if (bad.length) warnings.push(`dropped_summary_sentence_unsupported_skill:${bad.join("|")}`);
      return bad.length === 0;
    });
    out.summary = kept.join(" ").trim() || (profile.summary ?? "").trim();
  }

  // Structure: never emit empty sections, and never order a section that is
  // not there.
  for (const key of ["experience", "education", "projects", "skills"] as const) {
    const v = out[key];
    if (Array.isArray(v) && v.length === 0) {
      delete out[key];
      warnings.push(`removed_empty_section:${key}`);
    }
  }
  if (Array.isArray(out.section_order)) {
    out.section_order = out.section_order.filter(
      (sec: string) => sec === "summary" || (Array.isArray(out[sec]) && (out[sec] as unknown[]).length > 0)
    );
  }

  return { resume: out as ResumeShape, warnings };
}

// ── Detail-evidence guard ──────────────────────────────────────────────────
//
// Final live run: 11/11 passed the skill guard while bullets still gained
// methods, components and outcomes the candidate never wrote ("using Spring
// Boot batch jobs", "optimising query patterns", "improving deployment
// velocity and system resilience"). A rewrite may only rephrase: every
// content word it adds must be evidenced by what it was rewritten from — a
// bullet by its own role (title, company, bullets), a project description by
// that project. See lib/detail-evidence.ts. Otherwise the candidate's own
// bullet or description is restored, so no achievement is lost.

export function enforceDetailEvidence(resume: ResumeShape, profile: GenerationProfile) {
  const warnings: string[] = [];
  const out = { ...resume } as ResumeShape & Record<string, unknown>;

  if (Array.isArray(out.experience)) {
    out.experience = out.experience.map((exp) => {
      const src = (profile.experience ?? []).find(
        (p) => norm(p.company) === norm(exp.company ?? "") && norm(p.role) === norm(exp.role ?? "")
      ) ?? (profile.experience ?? []).find((p) => norm(p.company) === norm(exp.company ?? ""));
      if (!src) return exp;
      const evidence = new Evidence(src.role, src.company, ...src.bullets);
      const bullets = (exp.bullets ?? []).flatMap((b) => {
        const added = novelDetail(b, evidence);
        if (added.length === 0) return [b];
        const best = src.bullets
          .map((sb) => ({ sb, score: sourceSimilarity(b, sb) }))
          .sort((x, y) => y.score - x.score)[0];
        if (best && best.score >= 0.3) {
          warnings.push(`reverted_bullet_unsupported_detail:${added.join("|")}`);
          return [best.sb];
        }
        warnings.push(`dropped_bullet_unsupported_detail:${added.join("|")}`);
        return [];
      });
      return { ...exp, bullets: [...new Set(bullets)] };
    });
  }

  if (Array.isArray(out.projects)) {
    out.projects = out.projects.map((pr) => {
      const src = (profile.projects ?? []).find((p) => {
        const a = norm(p.name), b = norm(pr.name ?? "");
        return a === b || a.startsWith(b) || b.startsWith(a);
      });
      if (!src || typeof pr.description !== "string") return pr;
      const added = novelDetail(pr.description, new Evidence(src.name, src.description, ...src.tech));
      if (added.length === 0) return pr;
      warnings.push(`reverted_project_description_unsupported_detail:${added.join("|")}`);
      return { ...pr, description: src.description };
    });
  }

  return { resume: out as ResumeShape, warnings };
}

// ── Summary facts: years, detail and opening framing ───────────────────────
//
// Live S07 opened "Backend engineer with 1+ year of professional experience"
// for a candidate with 3.2 years; S10 said "3 years" for 4.3 years in the
// current job (5.3 in total); S02 and S09 opened "Proficient in ...", so the
// reader never learned who the candidate is. Sentences with an unsupported
// years claim or unevidenced detail are dropped; if nothing is left the
// candidate's own summary is used; and a summary that does not open with the
// candidate's identity gets the deterministic identity sentence first.

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z])/;
const IDENTITY_NOUN =
  /\b(engineers?|developers?|graduates?|analysts?|testers?|students?|professionals?|candidates?|specialists?|freshers?|interns?|leads?|architects?|scientists?|managers?|designers?|consultants?|administrators?|programmers?)\b/i;

export function opensWithIdentity(summary: string): boolean {
  const first = (summary ?? "").trim().split(SENTENCE_SPLIT)[0] ?? "";
  return IDENTITY_NOUN.test(first);
}

export function enforceSummaryFacts(resume: ResumeShape, profile: GenerationProfile, facts: CandidateFacts) {
  const warnings: string[] = [];
  const out = { ...resume } as ResumeShape & Record<string, unknown>;
  if (typeof out.summary !== "string") return { resume: out as ResumeShape, warnings };

  const evidence = new Evidence(
    profile.summary ?? "",
    profileEvidence(profile),
    ...(profile.experience ?? []).map((e) => e.company),
    ...(profile.education ?? []).flatMap((e) => [e.degree, e.institution]),
    typeof out.tailored_role === "string" ? out.tailored_role : "",
    facts.identity
  );
  const kept = out.summary.trim().split(SENTENCE_SPLIT).filter((sn) => {
    if (!sn.trim()) return false;
    const years = yearsProblems(sn, facts);
    if (years.length) {
      warnings.push(`dropped_summary_sentence_years:${years.map((y) => `${y.kind}:${y.claim}`).join("|")}`);
      return false;
    }
    const added = novelDetail(sn, evidence, { summary: true });
    if (added.length) {
      warnings.push(`dropped_summary_sentence_unsupported_detail:${added.join("|")}`);
      return false;
    }
    return true;
  });
  let summary = kept.join(" ").trim();
  if (!summary) {
    summary = (profile.summary ?? "")
      .trim()
      .split(SENTENCE_SPLIT)
      .filter((sn) => sn.trim() && yearsProblems(sn, facts).length === 0)
      .join(" ")
      .trim();
    if (summary) warnings.push("summary_fell_back_to_profile_summary");
  }
  if (facts.identity && !opensWithIdentity(summary)) {
    summary = `${facts.identity} ${summary}`.trim();
    warnings.push("summary_prepended_identity");
  }
  out.summary = summary;
  return { resume: out as ResumeShape, warnings };
}

// ── Advice guard ───────────────────────────────────────────────────────────
//
// Final live run: S11's growth_note told a candidate with no distributed
// systems evidence "You have strong full-stack and distributed systems
// fundamentals"; S10's said "Your current role demonstrates distributed
// systems exposure ... and code review initiation" and "You have 3 years" (5.3
// in total); an S11 tip said "Highlight code review leadership: add a bullet
// describing a code review initiative". Advice may tell a candidate to GAIN a
// skill; it may not credit them with one, or tell them to put one on the
// resume, that their profile does not evidence.

/**
 * A clause crediting the candidate with something: "you have", "you enforce",
 * "your role demonstrates", or a subjectless verdict ("Strong match on ...").
 */
const ASSERT =
  /^\s*(?:strong|solid|excellent|good|proven|deep|extensive|robust)\b|\byou(?:'ve|'re)\b|\byou\s+(?!should|could|can|may|might|will|would|need|must|want|to\b|consider|try)[a-z]+\b|\byour\b[^.;:]*?\b(?:demonstrates|shows|reflects|includes|highlights|proves)\b/i;
/** ...unless it says they lack it. */
const NEGATED = /\b(?:not|no|never|lacks?|lacking|without|missing|yet to|gaps?|limited|absent)\b/i;
/** Recommending acquisition, not presentation. */
const ACQUIRE =
  /\b(?:gain|gaining|learn|learning|build|building|study|studying|practi[sc]e|practi[sc]ing|complete|completing|earn|earning|contribute|contributing|take|taking|explore|exploring|pursue|pursuing|participate|participating|obtain|acquire|solve|solving|refactor|refactoring|apply|applying|develop|developing)\b/i;
/** Telling the candidate to put something on the resume. */
const EDIT_VERB = /\b(?:add|adding|highlight|highlighting|mention|mentioning|include|including|list|listing|emphasi[sz]e|showcase|feature|call out|inject|insert|incorporate|weave|name)\b/i;
const EDIT_TARGET = /\b(?:resume|cv|bullets?|summary|skills (?:section|list)|profile|role descriptions?)\b/i;
/**
 * "your system design contributions", "your System Design knowledge": the
 * possessive binds the skill itself to the candidate. ("your understanding of
 * distributed systems" does not — that is a thing to deepen.)
 */
const YOUR_SKILL = /\byour\s+(?:(?:current|existing|strong|solid|proven)\s+)?([\w/+#.-]+(?:\s+[\w/+#.-]+){0,2})/gi;

function adviceProblems(text: string, unevidenced: (t: string) => string[], facts: CandidateFacts): string[] {
  const problems: string[] = [];
  // Clauses end at ; : and contrast words — not commas, which also separate
  // the items of one list ("Strong match on Java, REST APIs, and system design").
  for (const clause of text.split(/[;:]|\bbut\b|\bhowever\b|\bwhereas\b|\bwhile\b/i)) {
    const bad = unevidenced(clause);
    if (bad.length && ASSERT.test(clause) && !NEGATED.test(clause) && !ACQUIRE.test(clause)) {
      problems.push(`credits_unevidenced:${bad.join("|")}`);
    }
    // "You have 3 years", "Your 2 years" — not "the role requires 1+ year".
    const aboutRole = /\b(?:requires?|required|asks?|expects?|needs?|minimum|calls for|targets?|seeks?)\b/i.test(clause);
    if ((ASSERT.test(clause) && !NEGATED.test(clause) && !aboutRole) || /\byour\s+(?:[a-z]+\s+){0,2}\d/i.test(clause)) {
      for (const y of yearsProblems(clause, facts)) problems.push(`years_${y.kind}:${y.claim}`);
    }
  }
  for (const m of text.matchAll(YOUR_SKILL)) {
    const rest = m[1].split(/\s+/).slice(1).join(" ");
    const bad = unevidenced(m[1]).filter((k) => !unevidenced(rest).includes(k));
    if (bad.length) problems.push(`presupposes_unevidenced:${bad.join("|")}`);
  }
  const bad = unevidenced(text);
  if (bad.length && EDIT_VERB.test(text) && EDIT_TARGET.test(text) && !ACQUIRE.test(text)) {
    problems.push(`resume_edit_unevidenced:${bad.join("|")}`);
  }
  return [...new Set(problems)];
}

export function enforceAdviceEvidence(resume: ResumeShape, profile: GenerationProfile, facts: CandidateFacts) {
  const warnings: string[] = [];
  const out = { ...resume } as ResumeShape & Record<string, unknown>;
  const evidenced = new Set(skillsMentioned(profileEvidence(profile)));
  const unevidenced = (t: string) => skillsMentioned(t).filter((k) => !evidenced.has(k));

  if (typeof out.growth_note === "string" && out.growth_note.trim() && out.growth_note.trim() !== "null") {
    const sentences = out.growth_note.trim().split(SENTENCE_SPLIT);
    const kept: string[] = [];
    let previousDropped = false;
    let previousSkills: string[] = [];
    for (const sn of sentences) {
      const p = adviceProblems(sn, unevidenced, facts);
      // "Inject these into bullets or summary", after a sentence naming skills
      // the candidate lacks.
      if (previousSkills.length && /\b(?:these|them|those|they)\b/i.test(sn) && EDIT_VERB.test(sn) && EDIT_TARGET.test(sn) && !ACQUIRE.test(sn)) {
        p.push(`resume_edit_unevidenced:${previousSkills.join("|")}`);
      }
      previousSkills = unevidenced(sn);
      // "Gaining experience in these ..." means nothing once its antecedent is gone.
      const dangling = previousDropped && /^(?:this|these|those|that|it|they|such)\b|\b(?:these|those|them)\b/i.test(sn);
      if (p.length || dangling) {
        warnings.push(`dropped_growth_note_sentence:${p.join(",") || "dangling_reference"}`);
        previousDropped = true;
        continue;
      }
      kept.push(sn);
      previousDropped = false;
    }
    let note = kept.join(" ").replace(/^(?:however|but|yet),?\s+/i, "").trim();
    note = note.charAt(0).toUpperCase() + note.slice(1);
    if (!note) {
      const missing = (Array.isArray(out.missing_keywords) ? out.missing_keywords : []).filter((k): k is string => typeof k === "string").slice(0, 3);
      note = missing.length
        ? `This role also asks for ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0]}, which your profile does not show yet; gaining hands-on experience with ${missing.length > 1 ? "them" : "it"} would strengthen your application.`
        : "";
      warnings.push("growth_note_replaced");
    }
    out.growth_note = note || null;
  }

  if (Array.isArray(out.profile_improvement_tips)) {
    out.profile_improvement_tips = out.profile_improvement_tips.filter((tip) => {
      if (typeof tip !== "string") return false;
      const p = adviceProblems(tip, unevidenced, facts);
      if (p.length) warnings.push(`dropped_tip:${p.join(",")}`);
      return p.length === 0;
    });
  }

  return { resume: out as ResumeShape, warnings };
}
