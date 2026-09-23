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
import {
  SKILL_SURFACE_TO_CANONICAL,
  SKILL_SURFACES_BY_LENGTH,
  AMBIGUOUS_SURFACE_GUARDS,
} from "@/lib/skill-lexicon";

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

/**
 * Strip punctuation that clings to a word without changing what the word IS.
 *
 * The tokenizer keeps "." and "/" because they are load-bearing inside real
 * skills — "Node.js", "CI/CD", ".NET", "C++". The cost is that a word at the
 * end of a sentence keeps its full stop, so the JD line "…and Agile delivery."
 * yielded the keyword "agile delivery." which then failed to match a resume
 * saying "Agile delivery" and was shown to the candidate as a missing skill.
 * Production produced exactly this: "software engineer.", "REST APIs.",
 * "engineer.".
 *
 * So: trim leading/trailing punctuation, but never touch the interior.
 */
export function trimPunctuation(token: string): string {
  return token.replace(/^[^a-z0-9+#]+/i, "").replace(/[^a-z0-9+#]+$/i, "");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\- ]/g, " ")
    .split(/\s+/)
    // Trailing full stops and stray dashes were surviving into keywords.
    .map(trimPunctuation)
    .filter(Boolean);
}


/**
 * Canonical skills present in a block of free text.
 *
 * Deliberately scans the WHOLE text rather than a parsed "Skills" section.
 * skills_overlap previously came from extractProfile().skills, which only
 * finds skills under a recognised section header — so the same person pasting
 * the same content scored 42 as an unstructured blob, 52 with skills in prose
 * and 72 with a "Skills" heading, and was told "0 skills overlap" while the
 * skills sat in plain sight. Formatting is not the thing being measured.
 *
 * Longest surface first, and each match is consumed, so "Spring Boot" is not
 * also counted as "Spring", and "JavaScript" is never counted as "Java".
 */
export function detectSkills(text: string): string[] {
  let haystack = " " + text.toLowerCase().replace(/\s+/g, " ") + " ";
  const found: string[] = [];
  const seen = new Set<string>();

  for (const surface of SKILL_SURFACES_BY_LENGTH) {
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Boundaries exclude only the characters that make a DIFFERENT word:
    // letters, digits, + and #. A trailing "." must count as a boundary or a
    // skill at the end of a sentence ("...and a microservice.") is missed —
    // which is the same punctuation bug that produced "engineer." upstream.
    // Compound skills containing "." or "/" are protected instead by being
    // matched first and consumed, since surfaces are ordered longest-first.
    const pattern = `(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`;
    const guard = AMBIGUOUS_SURFACE_GUARDS[surface];

    let hit = false;
    const re = new RegExp(pattern, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      // "I react quickly to incidents" is not React; "I excel at..." is not
      // Excel. Look at what follows the match before believing it.
      if (guard && guard.test(haystack.slice(m.index + m[0].length - 1))) continue;
      hit = true;
      break;
    }
    if (!hit) continue;

    const canonical = SKILL_SURFACE_TO_CANONICAL.get(surface)!;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      found.push(canonical);
    }
    // Consume every occurrence so a longer skill cannot be re-counted as a
    // shorter one contained within it ("Spring Boot" must not also yield
    // "Spring Framework", "Node.js" must not also yield "Node").
    haystack = haystack.replace(new RegExp(pattern, "gi"), "$1 $2");
  }
  return found;
}

/**
 * The terms a candidate should actually be judged against for this JD.
 *
 * Ordered: lexicon skills first (these are what a recruiter and an ATS both
 * care about), then salient single words that are not in the lexicon so a JD
 * using vocabulary we do not know about is still scored on something.
 *
 * Arbitrary adjacent bigrams are GONE. Weighting every adjacent pair at 2x
 * meant "react typescript", "typescript aws", "aws docker" and "docker
 * kubernetes" — an artefact of a comma-separated list in the JD — outranked
 * the real skills and filled the candidate's "missing keywords" panel with
 * word pairs no one can act on. A multi-word term now counts only if it is a
 * real skill in the lexicon.
 */
export function extractJdKeywords(jdText: string): string[] {
  const skills = detectSkills(jdText);
  const skillWords = new Set<string>();
  for (const s of skills) {
    for (const w of s.toLowerCase().split(/[\s/]+/)) skillWords.add(trimPunctuation(w));
  }

  const freq = new Map<string, number>();
  for (const t of tokenize(jdText)) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    // Tokens dominated by digits ("3yrs", "2x", "10x") are not keywords.
    if (/^\d/.test(t) && (t.match(/\d/g) ?? []).length >= t.length / 2) continue;
    // Already represented by a lexicon skill — do not list "spring" and
    // "boot" underneath "Spring Boot".
    if (skillWords.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  const extras = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);

  return [...skills, ...extras].slice(0, 30);
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

  // Skills the candidate demonstrably has, read from the whole resume rather
  // than from a parsed "Skills" section — see detectSkills().
  const resumeSkills = new Set(detectSkills(resumeText));
  const jdSkills = detectSkills(jdText);

  // Keyword match. Lexicon terms are compared canonically (so a resume writing
  // "REST APIs" satisfies a JD writing "RESTful API"); anything else falls
  // back to a literal whole-token check.
  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of jdKeywords) {
    const isLexiconSkill = jdSkills.includes(kw);
    const hit = isLexiconSkill ? resumeSkills.has(kw) : literalContains(haystack, kw);
    (hit ? matched : missing).push(kw);
  }
  const total = jdKeywords.length || 1;
  const keyword_match_pct = Math.round((matched.length / total) * 100);
  const keywordPts = (matched.length / total) * 50;

  // Skills overlap: genuine shared skills, in canonical form.
  const skills_overlap = jdSkills.filter((s) => resumeSkills.has(s));
  // Scale against what THIS JD actually asks for rather than a flat 8. A JD
  // naming four skills that the candidate fully matches is a complete match,
  // and should not be capped at half marks for the JD's brevity.
  const skillsDenominator = Math.max(1, Math.min(jdSkills.length, 12));
  const skillsPts = Math.min(skills_overlap.length / skillsDenominator, 1) * 20;

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
    // Only real skills are offered as "missing" when the JD names any. A
    // candidate can act on "add Kubernetes"; they cannot act on "add build".
    // Non-lexicon terms remain as a fallback for a JD whose vocabulary the
    // lexicon does not cover at all.
    missing_keywords: (missing.some((m) => jdSkills.includes(m))
      ? missing.filter((m) => jdSkills.includes(m))
      : missing
    ).slice(0, 10),
    skills_overlap,
    structure_flags,
    parsed: {
      word_count: wordCount,
      bullet_count: bullets.length,
      has_summary: !!profile.summary,
      has_experience: profile.experience.length > 0,
      has_education: profile.education.length > 0,
      // Skills detected across the whole resume, not just a parsed section.
      skill_count: resumeSkills.size,
    },
  };
}
