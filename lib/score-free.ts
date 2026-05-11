// Deterministic, LLM-free ATS scorer for the Free tier.
//
// Pure functions over plain text. Zero network calls. Zero AI imports.
// A jest test enforces that @anthropic-ai/sdk is never present in this
// module's import graph. If you reach for an LLM here, the test will fail
// — and that is the entire point of the Free tier.
//
// Inputs : { resumeText, jdText }   — both raw plain text
// Outputs: see ScoreFreeResult below.
//
// Scoring rubric (max 100):
//   KEYWORD MATCH   — 50 pts   (matched JD keywords / total JD keywords)
//   SKILLS OVERLAP  — 20 pts   (parsed skills that appear in JD)
//   STRUCTURE       — 30 pts   (3 pts per structural attribute, see below)
//
// Structure attributes (each present = +3 pts, missing = flag):
//   - has-summary
//   - has-experience-or-projects
//   - has-education
//   - has-skills-section
//   - has-contact-email
//   - has-quantified-bullets        (>= 2 bullets contain a number / %)
//   - has-strong-action-verbs       (>= 60% bullets begin with strong verb)
//   - reasonable-length             (250..900 words)
//   - no-weak-openers               (< 25% bullets start with weak openers)
//   - no-bias-fields                (no DOB / marital / photo references)
//
// Cap: ats_score is rounded to an integer in [0, 100].

import { extractProfile, type ExtractedProfile } from "@/lib/resume-parser";

export interface ScoreFreeResult {
  ats_score: number;
  keyword_match_pct: number;
  matched_keywords: string[];
  missing_keywords: string[];
  skills_overlap: string[];
  structure_flags: string[];
  parsed: {
    word_count: number;
    bullet_count: number;
    has_summary: boolean;
    has_experience: boolean;
    has_education: boolean;
    skill_count: number;
  };
}

const STOPWORDS = new Set<string>([
  "a","an","and","are","as","at","be","but","by","for","from","has","have",
  "in","into","is","it","its","of","on","or","our","that","the","their","this",
  "to","was","were","will","with","you","your","we","us","i","me","my","they",
  "them","than","then","over","under","about","across","also","any","all","both",
  "if","not","no","yes","do","does","did","such","very","just","each","other",
  "more","most","some","most","one","two","three","etc","via","per","upon",
  "within","while","when","where","what","which","who","whom","how","why",
  "would","could","should","may","might","can","up","down","out","off","new",
  "use","using","used","make","made","get","got","go","goes","going","work",
  "works","working","like","including","include","includes","included","based",
  "ability","strong","good","great","excellent","passion","passionate","team",
  "teams","role","roles","job","jobs","year","years","experience","experienced",
  "skills","skill","required","preferred","plus","etc","ideally","must","need",
  "needs","needed","candidate","candidates","you'll","we're","we'll",
  // Additions from observed bad bigrams in production (Nov 2025).
  "looking","seeking","seek","sought","hire","hiring","join","joining","apply",
  "applying","applicants","wanted","want","wants","know","knowledge","knows",
  "knowing","familiar","familiarity","prior","previous","plus","bonus","preferred",
  "ideal","you","you've","were","being","been","also","since","because","whether",
  "etc.","i.e.","e.g.","including","includes","etc",
  // Common job-ad words that aren't actually skills.
  "full","part","time","fulltime","parttime","remote","hybrid","onsite","onsite",
  "office","working","worked","work","jobs","job","position","positions","roles",
  "role","level","levels","tier","tiers","senior","junior","mid","entry","staff",
  "principal","intern","internship","freelance","contractor","permanent",
  "responsibility","responsibilities","duty","duties","day","daily","weekly",
  "monthly","yearly","annual","annually",
  // Pronouns / fillers.
  "he","she","him","her","his","hers","theirs","oneself","themselves","ourselves",
]);

// Bigrams that frequently appear in JDs but aren't useful as ATS keywords.
// Treat them as a hard denylist so they never enter the resume's "missing
// keywords" suggestions.
const JD_FILLER_BIGRAMS = new Set<string>([
  "looking for","seeking for","apply now","please apply","strong candidate",
  "ideal candidate","good candidate","ideal applicant","strong applicant",
  "must have","should have","nice have","good have","great have","prior experience",
  "previous experience","relevant experience","industry experience","work experience",
  "years experience","years working","years prior","year experience","year experience",
  "experience working","experience using","experience with","ability work","ability use",
  "strong written","strong verbal","strong communication","excellent communication",
  "excellent written","excellent verbal","good communication","good written","good verbal",
  "team player","team environment","fast paced","high growth","high performing","high quality",
  "high impact","problem solving","problem solver","critical thinking","attention detail",
  "attention details","detail oriented","results oriented","results driven","self starter",
  "self motivated","self driven","equal opportunity","candidate role","candidate must",
  "candidate should","candidate will","you will","you should","you must","we are","we have",
  "we offer","we believe","we want","our team","our company","our mission","our customers",
  "the role","the candidate","the team","the company","the ideal","the successful",
]);

const STRONG_VERBS = new Set<string>([
  "led","build","built","building","designed","design","implemented","implement",
  "delivered","deliver","scaled","scale","reduced","reduce","grew","grow",
  "launched","launch","optimised","optimized","optimise","optimize","automated",
  "automate","architected","architect","negotiated","negotiate","managed",
  "manage","developed","develop","deployed","deploy","analysed","analyzed",
  "analyse","analyze","streamlined","streamline","created","create","drove",
  "drive","owned","own","spearheaded","spearhead","shipped","ship","engineered",
  "engineer","authored","author","migrated","migrate","refactored","refactor",
  "improved","improve","increased","increase","decreased","decrease","cut",
  "saved","save","generated","generate","produced","produce","negotiated",
  "trained","train","mentored","mentor","coordinated","coordinate","initiated",
  "initiate","executed","execute","established","establish","facilitated",
  "facilitate","resolved","resolve","accelerated","accelerate",
]);

const WEAK_OPENERS = new Set<string>([
  "responsible","worked","helped","assisted","supported","participated",
  "involved","tasked","handled","did","performed",
]);

const BIAS_TERMS = [
  /\bdate of birth\b/i,
  /\bdob\b/i,
  /\bmarital status\b/i,
  /\bgender\b/i,
  /\breligion\b/i,
  /\bcaste\b/i,
  /\bphotograph\b/i,
  /\bphoto enclosed\b/i,
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

/**
 * Extract candidate keywords from a JD: unigrams that aren't stopwords +
 * bigrams that aren't entirely stopwords. Returns up to 30 unique keywords
 * ranked by frequency.
 */
export function extractJdKeywords(jdText: string): string[] {
  const toks = tokenize(jdText);
  const freq = new Map<string, number>();
  for (const t of toks) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    // Drop tokens that are dominated by digits ("3yrs", "2x", "10x").
    if (/^\d/.test(t) && (t.match(/\d/g) ?? []).length >= t.length / 2) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  for (const bg of ngrams(toks, 2)) {
    const [a, b] = bg.split(" ");
    // STRICT: skip a bigram if EITHER token is a stopword. Previously this
    // was && which let through garbage like "are looking", "looking for",
    // "senior full" (only one side stopword). For a keyword extractor we
    // want both sides to be meaningful.
    if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
    // Drop bigrams that contain pure numbers — "2 years", "5 years" are not
    // useful matchable keywords.
    if (/^\d+$/.test(a) || /^\d+$/.test(b)) continue;
    if (a.length < 3 || b.length < 3) continue;
    // Drop bigrams that look like job-ad filler ("looking for", "must have",
    // "should have"). The list grows from observed garbage in production.
    if (JD_FILLER_BIGRAMS.has(bg)) continue;
    freq.set(bg, (freq.get(bg) ?? 0) + 2); // weight bigrams slightly
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k]) => k);
}

function literalContains(haystack: string, needle: string): boolean {
  // Whole-token match — avoids "java" matching "javascript".
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(haystack);
}

function collectBullets(profile: ExtractedProfile): string[] {
  const bullets: string[] = [];
  for (const e of profile.experience) bullets.push(...e.bullets);
  for (const p of profile.projects) {
    if (p.description) bullets.push(p.description);
  }
  return bullets.map((b) => b.trim()).filter(Boolean);
}

function firstWord(line: string): string {
  const m = line.trim().toLowerCase().match(/^[a-z']+/);
  return m ? m[0] : "";
}

export function scoreFree(resumeText: string, jdText: string): ScoreFreeResult {
  const profile = extractProfile(resumeText);
  const haystack = resumeText.toLowerCase();
  const jdKeywords = extractJdKeywords(jdText);

  // Keyword match
  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of jdKeywords) {
    if (literalContains(haystack, kw)) matched.push(kw);
    else missing.push(kw);
  }
  const total = jdKeywords.length || 1;
  const keyword_match_pct = Math.round((matched.length / total) * 100);
  const keywordPts = (matched.length / total) * 50;

  // Skills overlap
  const skillsLower = new Set(profile.skills.map((s) => s.toLowerCase().trim()));
  const jdLower = jdText.toLowerCase();
  const skills_overlap = [...skillsLower].filter((s) => s && literalContains(jdLower, s));
  const skillsPts = Math.min(skills_overlap.length / 8, 1) * 20;

  // Structure
  const bullets = collectBullets(profile);
  const wordCount = resumeText.trim().split(/\s+/).filter(Boolean).length;
  const quantified = bullets.filter((b) => /\d/.test(b)).length;
  const strongStarts = bullets.filter((b) => STRONG_VERBS.has(firstWord(b))).length;
  const weakStarts = bullets.filter((b) => WEAK_OPENERS.has(firstWord(b))).length;
  const hasBiasField = BIAS_TERMS.some((re) => re.test(resumeText));

  const checks: { flag: string; ok: boolean }[] = [
    { flag: "missing-summary",            ok: !!(profile.summary && profile.summary.length > 30) },
    { flag: "missing-experience-or-projects", ok: profile.experience.length > 0 || profile.projects.length > 0 },
    { flag: "missing-education",          ok: profile.education.length > 0 },
    { flag: "missing-skills-section",     ok: profile.skills.length > 0 },
    { flag: "missing-contact-email",      ok: !!profile.email },
    { flag: "too-few-quantified-bullets", ok: quantified >= 2 },
    { flag: "weak-action-verbs",          ok: bullets.length === 0 ? true : strongStarts / bullets.length >= 0.6 },
    { flag: "too-long",                   ok: wordCount <= 900 },
    { flag: "too-short",                  ok: wordCount >= 250 },
    { flag: "weak-openers-present",       ok: bullets.length === 0 ? true : weakStarts / bullets.length < 0.25 },
    { flag: "bias-fields-present",        ok: !hasBiasField },
  ];

  const passed = checks.filter((c) => c.ok).length;
  const structurePts = (passed / checks.length) * 30;
  const structure_flags = checks.filter((c) => !c.ok).map((c) => c.flag);

  const ats_score = Math.max(
    0,
    Math.min(100, Math.round(keywordPts + skillsPts + structurePts))
  );

  return {
    ats_score,
    keyword_match_pct,
    matched_keywords: matched,
    missing_keywords: missing.slice(0, 10),
    skills_overlap,
    structure_flags,
    parsed: {
      word_count: wordCount,
      bullet_count: bullets.length,
      has_summary: !!profile.summary,
      has_experience: profile.experience.length > 0,
      has_education: profile.education.length > 0,
      skill_count: profile.skills.length,
    },
  };
}
