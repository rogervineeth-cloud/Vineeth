// Deterministic resume-quality evaluator.
//
// Scores (a) the PRE-MODEL payload production would send for a scenario and
// (b) a generated resume, against the source profile and JD. No network, no
// model, no database — pure functions, unit-tested in
// __tests__/resume-quality-eval.test.ts.
//
// Skill detection uses lib/score-free's lexicon matcher (independent of the
// create page's keyword extractor, so the system is not grading itself) plus
// a small eval-only vocabulary for terms the production lexicon deliberately
// omits.

import { detectSkills } from "@/lib/score-free";
import { analyzeJd } from "@/lib/jd-keywords";
import { buildGenerationPayload, type GenerationProfile, type GenerationPayload } from "@/lib/resume-generation";
import { profileNumbers, unverifiableNumbers, extractNumbers } from "@/lib/sanitise-resume";

// ── Fixture types ──────────────────────────────────────────────────────────

export type ProfileFixture = {
  id: string;
  label: string;
  /** Date the "Present"-relative facts below were computed for (YYYY-MM-DD). */
  facts_as_of?: string;
  facts: {
    professional_years: number;
    has_employment: boolean;
    internship_only: boolean;
    career_gap: { from: string; to: string; months: number } | null;
  };
  user_profile: GenerationProfile & {
    full_name: string;
    email: string;
    graduation_year?: number | null;
  };
};

export type JdFixture = {
  id: string;
  company: string;
  title: string;
  url: string;
  /**
   * OFFICIAL: verbatim posting. OFFICIAL_PARAPHRASE: requirements verified
   * against the official posting, condensed wording. RECONSTRUCTED_PLACEHOLDER:
   * not verified.
   */
  source_status: "OFFICIAL" | "OFFICIAL_PARAPHRASE" | "RECONSTRUCTED_PLACEHOLDER";
  source_verified_by?: string;
  source_verified_date?: string;
  /** min_years is null when the posting states no minimum. */
  expected: { level: string; min_years: number | null; ground_truth_skills: string[] };
  text: string;
};

export type Fit = "match" | "under" | "mismatch";
export type Scenario = { id: string; profile: string; jd: string; expected_fit: Fit; why: string };

export type GeneratedResume = {
  section_order?: string[];
  summary?: string;
  experience?: { company?: string; role?: string; duration?: string; location?: string; bullets?: string[] }[];
  skills?: string[];
  education?: { institution?: string; degree?: string; year?: string }[];
  projects?: { name?: string; description?: string; tech?: string[] }[];
  ats_score?: number;
  matched_keywords?: string[];
  missing_keywords?: string[];
  tailored_role?: string;
  growth_note?: string | null;
  profile_improvement_tips?: string[];
  [k: string]: unknown;
};

// ── Skill vocabulary ──────────────────────────────────────────────────────

/** Eval-only terms the production lexicon omits. [canonical, regex source, flags] */
const EXTRA_TERMS: [string, string, string][] = [
  ["Data Structures", "\\bdata[- ]structures?\\b", "i"],
  ["Algorithms", "\\balgorithms?\\b", "i"],
  ["Distributed Systems", "\\bdistributed (?:systems?|computing)\\b", "i"],
  ["Object-Oriented Design", "\\bobject[- ]oriented (?:design|programming)\\b|\\bOOP\\b", "i"],
  ["Design Patterns", "\\bdesign patterns?\\b", "i"],
  // "Review code developed by other developers" is a code-review requirement.
  ["Code Review", "\\breview(?:ed|ing)? (?:the )?code\\b|\\bcode reviews?\\b", "i"],
  ["Accessibility", "\\baccessib(?:le|ility)\\b|\\ba11y\\b", "i"],
  ["BLE", "\\bBLE\\b|\\bBluetooth Low Energy\\b", ""],
  ["FreeRTOS", "\\bFreeRTOS\\b", "i"],
  ["pytest", "\\bpytest\\b", "i"],
  ["JPA", "\\bJPA\\b", ""],
  ["JMeter", "\\bJMeter\\b", "i"],
  ["Embedded C", "\\bEmbedded C\\b", "i"],
  ["C", "(?<![A-Za-z0-9+#/.-])C(?![A-Za-z0-9+#])(?!\\s*[-/]\\s*level)", ""],
  // The lexicon knows "mentoring"; profiles say "mentored 2 engineers".
  ["Mentoring", "\\bmentor(?:ed|ing|s)?\\b", "i"],
  // Case-sensitive: "go" is ordinary English, "Go" in a language list is not.
  ["Golang", "(?<![A-Za-z0-9])Go(?![A-Za-z0-9-])", ""],
];

/** Canonical skills mentioned in `text`: production lexicon + eval extras. */
export function skillsIn(text: string): Set<string> {
  const out = new Set(detectSkills(text));
  for (const [canonical, src, flags] of EXTRA_TERMS) {
    if (new RegExp(src, flags).test(text)) out.add(canonical);
  }
  return out;
}

/** Map one keyword (e.g. a create-page curated keyword) to evaluator canonical form. */
export function canonicalOf(keyword: string): string | null {
  const found = [...skillsIn(keyword)];
  return found[0] ?? null;
}

// ── Profile helpers ───────────────────────────────────────────────────────

export function profileText(p: GenerationProfile): string {
  const parts: string[] = [p.summary ?? "", ...(p.skills ?? [])];
  for (const e of p.experience ?? []) parts.push(e.role, e.company, ...e.bullets);
  for (const e of p.education ?? []) parts.push(e.degree, e.institution);
  for (const pr of p.projects ?? []) parts.push(pr.name, pr.description, ...pr.tech);
  return parts.join("\n");
}

const n = (s: string | undefined | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

function normDuration(s: string | undefined): string {
  return (s ?? "").replace(/[–—]/g, "-").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim().toLowerCase();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function monthIndex(token: string, present: number): number | null {
  const t = token.trim().toLowerCase();
  if (t.startsWith("present") || t.startsWith("current")) return present;
  const m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1]);
  return mi < 0 ? null : Number(m[2]) * 12 + mi;
}
function durationRange(d: string | undefined, present: number): [number, number] | null {
  const parts = normDuration(d).split(" - ");
  if (parts.length !== 2) return null;
  const a = monthIndex(parts[0], present);
  const b = monthIndex(parts[1], present);
  return a === null || b === null ? null : [a, b];
}

function resumeText(r: GeneratedResume): string {
  const parts: string[] = [r.summary ?? "", ...(r.skills ?? [])];
  for (const e of r.experience ?? []) parts.push(e.role ?? "", e.company ?? "", ...(e.bullets ?? []));
  for (const e of r.education ?? []) parts.push(e.degree ?? "", e.institution ?? "");
  for (const pr of r.projects ?? []) parts.push(pr.name ?? "", pr.description ?? "", ...(pr.tech ?? []));
  return parts.join("\n");
}

function proseText(r: GeneratedResume): string {
  const parts: string[] = [r.summary ?? ""];
  for (const e of r.experience ?? []) parts.push(...(e.bullets ?? []));
  for (const pr of r.projects ?? []) parts.push(pr.description ?? "");
  return parts.join("\n");
}

const ratio = (num: number, den: number) => (den === 0 ? 1 : Math.round((num / den) * 1000) / 1000);

// ── Pre-model: the payload production would send ──────────────────────────

export type PayloadReport = {
  curated_keywords: string[];
  jd_skills: string[];
  profile_skills: string[];
  attainable_skills: string[];
  intersection: string[];
  jd_only: string[];
  /** Candidate HAS it, but the model is told to never claim it. */
  truthful_but_marked_jd_only: string[];
  /** Candidate LACKS it, but the model is told to inject it. */
  absent_but_marked_intersection: string[];
  /** Curated keyword that is not actually a skill named in the JD. */
  curated_not_in_jd: string[];
  /** Share of curated-and-attainable skills placed in INTERSECTION. */
  payload_recall_ceiling: number;
  /**
   * Share of ALL truthful JD requirements (attainable skills) the model is
   * told to include (INTERSECTION). Anything else is left to chance: STEP 0
   * of the prompt only guarantees curated/intersection keywords.
   */
  must_inject_coverage: number;
  /** Attainable skills the model is not told to include. */
  attainable_not_licensed: string[];
  payload: GenerationPayload;
};

export function evaluatePayload(profile: ProfileFixture, jd: JdFixture, now: Date = new Date()): PayloadReport {
  // What the create page proposes and the candidate accepts by default.
  const curated = analyzeJd(jd.text).keywords;
  const payload = buildGenerationPayload({ jd_text: jd.text, jd_keywords: curated, template: "classic", user_profile: profile.user_profile, now });

  const jdSkills = skillsIn(jd.text);
  const have = skillsIn(profileText(profile.user_profile));
  const attainable = [...jdSkills].filter((s) => have.has(s));

  const truthfulJdOnly: string[] = [];
  const absentIntersection: string[] = [];
  const notInJd: string[] = [];
  const intersectionCanon = new Set<string>();
  for (const k of curated) {
    const c = canonicalOf(k);
    if (c && !jdSkills.has(c)) notInJd.push(k);
    const has = c ? have.has(c) : false;
    if (payload.INTERSECTION_SKILLS.includes(k)) {
      if (c) intersectionCanon.add(c);
      if (c && !has) absentIntersection.push(k);
    }
    if (payload.JD_ONLY_SKILLS.includes(k) && has) truthfulJdOnly.push(k);
  }
  const curatedAttainable = attainable.filter((s) => curated.some((k) => canonicalOf(k) === s));
  const licensed = curatedAttainable.filter((s) => intersectionCanon.has(s));

  return {
    curated_keywords: curated,
    jd_skills: [...jdSkills].sort(),
    profile_skills: [...have].sort(),
    attainable_skills: attainable.sort(),
    intersection: payload.INTERSECTION_SKILLS,
    jd_only: payload.JD_ONLY_SKILLS,
    truthful_but_marked_jd_only: truthfulJdOnly,
    absent_but_marked_intersection: absentIntersection,
    curated_not_in_jd: notInJd,
    payload_recall_ceiling: ratio(licensed.length, curatedAttainable.length),
    must_inject_coverage: ratio(attainable.filter((s) => intersectionCanon.has(s)).length, attainable.length),
    attainable_not_licensed: attainable.filter((s) => !intersectionCanon.has(s)),
    payload,
  };
}

// ── Post-model: the generated resume ──────────────────────────────────────

export type Gate = { gate: string; pass: boolean; defects: string[] };

export type ResumeReport = {
  gates: Gate[];
  metrics: {
    claims_checked: number;
    unsupported_claims: number;
    unsupported_claim_rate: number;
    keyword_precision: number;
    keyword_recall: number;
    ats_score: number | null;
    word_count: number;
  };
  interview_chance: "strong" | "adequate" | "weak";
  interview_reasons: string[];
};

const WEAK_OPENERS = /^(responsible for|worked on|helped|assisted|supported)\b/i;
const FIRST_PERSON = /\b(I|my|me|I'm|I've)\b/;
const RELATIVE_TITLE = /(for|targeting|seeking|toward|towards|to|pursue|pursuing|a|an|the)\s+(the\s+)?$/i;
/** "<title> candidate/role/position" frames the role sought, not a claimed level. */
const TITLE_AS_TARGET = /^\s*(candidate|role|position|opening|opportunity|aspirant)\b/i;
/** "3+ years" in a summary is a derived claim; seniority_calibration checks it. */
const YEARS_CLAIM = /\d+(?:\.\d+)?\+?\s*(?:years?|yrs?)\b/gi;

// ── Detail, framing and advice helpers ───────────────────────────────────
//
// Independent of lib/detail-evidence (the production guard): a different
// tokeniser (5-letter prefix matching) and its own, smaller neutral vocabulary.

const FUNCTION_WORDS = new Set(
  ("a an the and or but nor of to for with in on at by from into over under across via per as that which who " +
    "this these those it its their them they is are was were be been has have had can will also then than " +
    "so such both each all more most other while during through within between after before up out about " +
    "using used use including").split(" ")
);
/** Plain execution verbs and units a rephrase may introduce. */
export const NEUTRAL = new Set(
  ("built build developed implemented created wrote written authored delivered completed executed conducted " +
    "performed ran run fixed resolved added reduced reducing cut lowered collaborated partnered worked " +
    "ms hours hour days day daily weeks week weekly months month monthly years year million thousand").split(" ")
);
const SUMMARY_NEUTRAL = new Set([
  ...NEUTRAL,
  ..."experience experienced professional seeking targeting pursuing applying role position opportunity graduate fresher student candidate background career focus focused development engineering software currently hands".split(" "),
]);

const stem5 = (w: string) =>
  w.replace(/iz/g, "is").replace(/ies$/, "y").replace(/(?:ing|ed|es|s)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1").slice(0, 5);
function words(text: string): string[] {
  return (text ?? "").toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 2 && /[a-z]/.test(w) && !FUNCTION_WORDS.has(w));
}
function wordSet(text: string): Set<string> {
  return new Set(words(text).map(stem5));
}
/** Content words of `text` absent from `scope` and not neutral. */
export function addedWords(text: string, scope: Set<string>, neutral: Set<string>): string[] {
  const neutralStems = new Set([...neutral].map(stem5));
  return [...new Set(words(text).filter((w) => !scope.has(stem5(w)) && !neutralStems.has(stem5(w))))];
}

const IDENTITY =
  /\b(?:engineers?|developers?|graduates?|analysts?|testers?|students?|professionals?|candidates?|specialists?|freshers?|interns?|leads?|architects?|scientists?|managers?|designers?|consultants?|programmers?)\b/i;
const CREDIT =
  /^\s*(?:strong|solid|excellent|good|proven|deep|extensive|robust)\b|\byou(?:'ve|'re)\b|\byou\s+(?!should|could|can|may|might|will|would|need|must|want|to\b|consider|try)[a-z]+\b|\byour\b[^.;:]*?\b(?:demonstrates|shows|reflects|includes|highlights|proves)\b/i;
const LACK = /\b(?:not|no|never|lacks?|lacking|without|missing|yet to|gaps?|limited|absent)\b/i;
const GAIN =
  /\b(?:gain|gaining|learn|learning|build|building|study|studying|practi[sc]e|practi[sc]ing|complete|earn|contribute|contributing|take|explore|exploring|pursue|participate|obtain|acquire|solve|solving|refactor|apply|applying|develop|developing)\b/i;
const EDIT = /\b(?:add|adding|highlight|highlighting|mention|mentioning|include|list|emphasi[sz]e|showcase|feature|call out|inject|insert|incorporate|weave|name)\b/i;
const EDIT_TARGET = /\b(?:resume|cv|bullets?|summary|skills (?:section|list)|profile|role descriptions?)\b/i;

/** Months at each non-internship employer, in years. */
function employerYears(up: ProfileFixture["user_profile"], present: number): number[] {
  const by = new Map<string, Set<number>>();
  for (const e of up.experience ?? []) {
    if (/\bintern(?:ship)?s?\b|\btrainee\b|\bapprentice\b/i.test(e.role)) continue;
    const r = durationRange(e.duration, present);
    if (!r) continue;
    const k = n(e.company);
    const set = by.get(k) ?? new Set<number>();
    for (let m = r[0]; m <= r[1]; m++) set.add(m);
    by.set(k, set);
  }
  return [...by.values()].map((s) => s.size / 12);
}

/**
 * Years claims that neither total professional years nor one employer's
 * tenure supports. "of (professional) experience" claims are about the whole
 * career, so only the total counts for them.
 */
function yearsDefects(text: string, total: number, tenures: number[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(\+)?(?:\s*|-)(?:years?|yrs?)\b/gi)) {
    const x = Number(m[1]);
    const after = text.slice((m.index ?? 0) + m[0].length);
    const overall = /^\s*(?:of\s+)?(?:(?:professional|industry|total|overall|work|working)\b|experience\b)/i.test(after);
    const measures = (overall ? [total] : [total, ...tenures]).filter((v) => v > 0);
    if (measures.some((v) => x >= Math.floor(v) && x <= v + (m[2] ? 0 : 0.5))) continue;
    const max = Math.max(0, ...measures);
    out.push(x > max ? `overstates experience: "${m[0]}" vs ${total} professional years` : `understates experience: "${m[0]}" vs ${total} professional years`);
  }
  return out;
}

export function evaluateResume(
  profile: ProfileFixture,
  jd: JdFixture,
  scenario: Scenario,
  r: GeneratedResume,
  now: Date = new Date()
): ResumeReport {
  const up = profile.user_profile;
  const gates: Gate[] = [];
  const present = now.getUTCFullYear() * 12 + now.getUTCMonth();

  // 1. Factual fidelity ---------------------------------------------------
  const fid: string[] = [];
  let claims = 0;
  const profExp = up.experience ?? [];
  for (const e of r.experience ?? []) {
    claims += 3;
    const match = profExp.find((p) => n(p.company) === n(e.company) && n(p.role) === n(e.role))
      ?? profExp.find((p) => n(p.company) === n(e.company));
    if (!match) { fid.push(`fabricated employer "${e.company}"`); continue; }
    if (n(match.role) !== n(e.role)) fid.push(`role changed: "${match.role}" -> "${e.role}"`);
    if (normDuration(match.duration) !== normDuration(e.duration)) fid.push(`duration changed for ${e.company}: "${match.duration}" -> "${e.duration}"`);
  }
  for (const e of r.education ?? []) {
    claims += 1;
    if (!(up.education ?? []).some((p) => n(p.institution) === n(e.institution))) fid.push(`unknown institution "${e.institution}"`);
  }
  for (const pr of r.projects ?? []) {
    claims += 1;
    const on = n(pr.name);
    const ok = (up.projects ?? []).some((p) => {
      const pn = n(p.name);
      return pn === on || pn.startsWith(on) || on.startsWith(pn) || pn.split(" ")[0] === on.split(" ")[0];
    });
    if (!ok) fid.push(`unknown project "${pr.name}"`);
  }
  const have = skillsIn(profileText(up));
  const haveLiteral = n(profileText(up));
  for (const s of r.skills ?? []) {
    claims += 1;
    const c = canonicalOf(s);
    const supported = c ? have.has(c) : haveLiteral.includes(n(s));
    if (!supported) fid.push(`unsupported skill "${s}"`);
  }
  for (const s of skillsIn(proseText(r))) {
    claims += 1;
    if (!have.has(s)) fid.push(`unsupported skill in prose "${s}"`);
  }
  const allowedNums = profileNumbers({
    summary: up.summary, experience: up.experience ?? [], education: up.education ?? [], projects: up.projects ?? [], skills: up.skills ?? [],
  });
  // Numbers are grounded in their OWN entry: a bullet only in its role, a
  // project description only in that project. Profile-wide grounding let a
  // QA bullet reuse "5" from another job (live S10) and still pass.
  const badNums: string[] = [];
  const summaryBad = unverifiableNumbers((r.summary ?? "").replace(YEARS_CLAIM, ""), allowedNums);
  badNums.push(...summaryBad);
  for (const e of r.experience ?? []) {
    const src = profExp.find((p) => n(p.company) === n(e.company) && n(p.role) === n(e.role)) ?? profExp.find((p) => n(p.company) === n(e.company));
    const allowed = src ? extractNumbers([src.duration, src.role, ...src.bullets].join(" ")) : allowedNums;
    for (const b of e.bullets ?? []) {
      for (const x of unverifiableNumbers(b.replace(YEARS_CLAIM, ""), allowed)) badNums.push(`${x} (in ${e.company} bullet)`);
    }
  }
  for (const pr of r.projects ?? []) {
    const src = (up.projects ?? []).find((p) => { const a = n(p.name), b = n(pr.name); return a === b || a.startsWith(b) || b.startsWith(a); });
    const allowed = src ? extractNumbers([src.name, src.description, ...src.tech].join(" ")) : allowedNums;
    for (const x of unverifiableNumbers((pr.description ?? "").replace(YEARS_CLAIM, ""), allowed)) badNums.push(`${x} (in project ${pr.name})`);
  }
  claims += badNums.length;
  for (const x of badNums) fid.push(`unverifiable number "${x}"`);
  gates.push({ gate: "factual_fidelity", pass: fid.length === 0, defects: fid });

  // 2. ATS keyword relevance ---------------------------------------------
  const jdSkills = skillsIn(jd.text);
  const attainable = [...jdSkills].filter((s) => have.has(s));
  const inResume = [...skillsIn(resumeText(r))].filter((s) => jdSkills.has(s));
  const truthfulHits = inResume.filter((s) => have.has(s));
  const precision = ratio(truthfulHits.length, inResume.length);
  const recall = ratio(truthfulHits.length, attainable.length);
  const kw: string[] = [];
  if (precision < 1) kw.push(`JD keywords claimed without evidence: ${inResume.filter((s) => !have.has(s)).join(", ")}`);
  if (recall < 0.8) kw.push(`truthful JD keywords left out: ${attainable.filter((s) => !inResume.includes(s)).join(", ")}`);
  const missingOwn = (r.missing_keywords ?? []).filter((k) => { const c = canonicalOf(k); return c ? have.has(c) : false; });
  if (missingOwn.length) kw.push(`candidate told to add skills they already have: ${missingOwn.join(", ")}`);
  gates.push({ gate: "ats_keywords", pass: kw.length === 0, defects: kw });

  // 3. Seniority-fit calibration -----------------------------------------
  const sen: string[] = [];
  const score = typeof r.ats_score === "number" ? r.ats_score : null;
  const note = (r.growth_note ?? "").trim();
  if (scenario.expected_fit !== "match") {
    const cap = scenario.expected_fit === "mismatch" ? 55 : 65;
    if (score === null || score > cap) sen.push(`ats_score ${score} too high for a ${scenario.expected_fit} (cap ${cap})`);
    if (!note) sen.push("no growth_note explaining the level gap");
  } else if (score !== null && score < 50) {
    sen.push(`ats_score ${score} undersells a matching profile`);
  }
  const summary = r.summary ?? "";
  const tenures = employerYears(up, present);
  for (const d of yearsDefects(summary, profile.facts.professional_years, tenures)) sen.push(`summary ${d}`);
  if (scenario.expected_fit !== "match") {
    const title = jd.title.split(",")[0].trim();
    let idx = summary.toLowerCase().indexOf(title.toLowerCase());
    while (idx >= 0) {
      const before = summary.slice(Math.max(0, idx - 40), idx);
      const after = summary.slice(idx + title.length);
      if (!RELATIVE_TITLE.test(before) && !TITLE_AS_TARGET.test(after)) {
        sen.push(`summary presents the target title "${title}" as the candidate's own level`);
        break;
      }
      idx = summary.toLowerCase().indexOf(title.toLowerCase(), idx + 1);
    }
  }
  gates.push({ gate: "seniority_calibration", pass: sen.length === 0, defects: sen });

  // 4. Section completeness ----------------------------------------------
  const sec: string[] = [];
  if (!summary.trim()) sec.push("missing summary");
  if (!(r.skills ?? []).length) sec.push("missing skills");
  if ((r.skills ?? []).length > 15) sec.push(`${r.skills!.length} skills (max 15)`);
  if ((up.education ?? []).length && !(r.education ?? []).length) sec.push("education dropped");
  if (profExp.length && !(r.experience ?? []).length) sec.push("experience dropped");
  if ((up.projects ?? []).length && !(r.projects ?? []).length) sec.push("projects dropped");
  for (const k of ["experience", "education", "projects", "skills"] as const) {
    const v = r[k];
    if (Array.isArray(v) && v.length === 0) sec.push(`empty "${k}" array emitted`);
  }
  gates.push({ gate: "section_completeness", pass: sec.length === 0, defects: sec });

  // 5. Readability / candidate friendliness ------------------------------
  const rd: string[] = [];
  const summaryWords = summary.split(/\s+/).filter(Boolean).length;
  if (summaryWords > 90) rd.push(`summary ${summaryWords} words (max 90)`);
  const bullets = (r.experience ?? []).flatMap((e) => e.bullets ?? []);
  for (const b of bullets) {
    if (b.length > 220) rd.push(`bullet over 220 chars: "${b.slice(0, 50)}..."`);
    if (WEAK_OPENERS.test(b.trim())) rd.push(`weak opener: "${b.slice(0, 40)}..."`);
  }
  for (const e of r.experience ?? []) if ((e.bullets ?? []).length > 5) rd.push(`${e.company}: ${(e.bullets ?? []).length} bullets (max 5)`);
  if (FIRST_PERSON.test(proseText(r))) rd.push("first-person pronoun in resume text");
  const nonAscii = [...new Set(resumeText(r).match(/[^\x00-\x7F₹]/g) ?? [])];
  if (nonAscii.length) rd.push(`non-ASCII characters: ${nonAscii.join(" ")}`);
  const words = resumeText(r).split(/\s+/).filter(Boolean).length;
  if (words > 750) rd.push(`${words} words (one page is ~450-550)`);
  gates.push({ gate: "readability", pass: rd.length === 0, defects: rd });

  // 6. Career-gap treatment ----------------------------------------------
  const gap = profile.facts.career_gap;
  const gp: string[] = [];
  if (gap) {
    const g = durationRange(`${gap.from} - ${gap.to}`, present);
    for (const e of r.experience ?? []) {
      const rr = durationRange(e.duration, present);
      if (g && rr && rr[0] <= g[1] && rr[1] >= g[0]) gp.push(`"${e.company}" (${e.duration}) covers the career break`);
    }
  }
  gates.push({ gate: "career_gap", pass: gp.length === 0, defects: gp });

  // 7. Projects vs employment --------------------------------------------
  const pe: string[] = [];
  const projectNames = (up.projects ?? []).map((p) => n(p.name).split(" ")[0]);
  for (const e of r.experience ?? []) {
    if (projectNames.includes(n(e.company).split(" ")[0])) pe.push(`project "${e.company}" presented as employment`);
  }
  if (!profile.facts.has_employment && (r.experience ?? []).length) pe.push("experience section emitted for a candidate with no employment");
  if (profile.facts.internship_only) {
    for (const e of r.experience ?? []) if (!/intern/i.test(e.role ?? "")) pe.push(`internship relabelled as "${e.role}"`);
  }
  gates.push({ gate: "projects_vs_employment", pass: pe.length === 0, defects: pe });

  // 8. Detail fidelity ---------------------------------------------------
  // A rewrite may rephrase, not elaborate: every content word a bullet adds
  // must appear in its own role (title, company, bullets); a project
  // description's in that project; a summary's anywhere in the profile or the
  // target title. The final live run passed factual_fidelity 11/11 with
  // "using Spring Boot batch jobs" and "optimising query patterns" invented.
  const det: string[] = [];
  for (const e of r.experience ?? []) {
    const src = profExp.find((p) => n(p.company) === n(e.company) && n(p.role) === n(e.role)) ?? profExp.find((p) => n(p.company) === n(e.company));
    if (!src) continue;
    const scope = wordSet([src.role, src.company, ...src.bullets].join(" "));
    for (const b of e.bullets ?? []) {
      const added = addedWords(b, scope, NEUTRAL);
      if (added.length) det.push(`${e.company} bullet adds "${added.join(", ")}": "${b.slice(0, 60)}..."`);
    }
  }
  for (const pr of r.projects ?? []) {
    const src = (up.projects ?? []).find((p) => { const a = n(p.name), b = n(pr.name); return a === b || a.startsWith(b) || b.startsWith(a); });
    if (!src) continue;
    const added = addedWords(pr.description ?? "", wordSet([src.name, src.description, ...src.tech].join(" ")), NEUTRAL);
    if (added.length) det.push(`project ${pr.name} adds "${added.join(", ")}"`);
  }
  {
    const scope = wordSet([profileText(up), jd.title, r.tailored_role ?? ""].join(" "));
    const added = addedWords(summary, scope, SUMMARY_NEUTRAL);
    if (added.length) det.push(`summary adds "${added.join(", ")}"`);
  }
  gates.push({ gate: "detail_fidelity", pass: det.length === 0, defects: det });

  // 9. Summary framing ---------------------------------------------------
  // The first sentence says who the candidate is ("Software Engineer with 3+
  // years", "Computer Science graduate"), not "Proficient in Java...".
  const fr: string[] = [];
  const firstSentence = summary.trim().split(/(?<=[.!?])\s+(?=[A-Z])/)[0] ?? "";
  if (summary.trim() && !IDENTITY.test(firstSentence)) fr.push(`summary opens without the candidate's identity: "${firstSentence.slice(0, 60)}"`);
  gates.push({ gate: "summary_framing", pass: fr.length === 0, defects: fr });

  // 10. Advice fidelity --------------------------------------------------
  // growth_note and tips may tell the candidate to GAIN a skill; they may not
  // credit them with one the profile lacks, state their experience wrongly,
  // or tell them to put an unevidenced skill on the resume.
  const adv: string[] = [];
  const advice = [
    ...(typeof r.growth_note === "string" && r.growth_note !== "null" ? r.growth_note.split(/(?<=[.!?])\s+(?=[A-Z])/).map((t) => ["growth_note", t] as const) : []),
    ...(Array.isArray(r.profile_improvement_tips) ? r.profile_improvement_tips.map((t) => ["tip", t] as const) : []),
  ];
  let prevLacking: string[] = [];
  for (const [where, text] of advice) {
    const lacking = (t: string) => [...skillsIn(t)].filter((k) => !have.has(k));
    for (const clause of text.split(/[;:]|\b(?:but|however|whereas|while)\b/i)) {
      const credits = CREDIT.test(clause) && !LACK.test(clause) && !GAIN.test(clause);
      if (credits && lacking(clause).length) adv.push(`${where} credits the candidate with ${lacking(clause).join(", ")}: "${clause.trim().slice(0, 70)}"`);
      if ((credits && !/\b(?:requires?|required|asks?|expects?|needs?|minimum|targets?)\b/i.test(clause)) || /\byour\s+(?:[a-z]+\s+){0,2}\d/i.test(clause)) {
        for (const d of yearsDefects(clause, profile.facts.professional_years, tenures)) adv.push(`${where} ${d}`);
      }
    }
    for (const m of text.matchAll(/\byour\s+(?:(?:current|existing|strong|solid|proven)\s+)?([\w/+#.-]+(?:\s+[\w/+#.-]+){0,2})/gi)) {
      const rest = m[1].split(/\s+/).slice(1).join(" ");
      const bad = lacking(m[1]).filter((k) => !lacking(rest).includes(k));
      if (bad.length) adv.push(`${where} presupposes the candidate's ${bad.join(", ")}: "your ${m[1]}"`);
    }
    const editsResume = EDIT.test(text) && EDIT_TARGET.test(text) && !GAIN.test(text);
    if (editsResume && lacking(text).length) adv.push(`${where} tells the candidate to put ${lacking(text).join(", ")} on the resume`);
    if (editsResume && where === "growth_note" && prevLacking.length && /\b(?:these|them|those|they)\b/i.test(text)) {
      adv.push(`growth_note tells the candidate to put ${prevLacking.join(", ")} on the resume`);
    }
    prevLacking = where === "growth_note" ? lacking(text) : [];
  }
  gates.push({ gate: "advice_fidelity", pass: adv.length === 0, defects: [...new Set(adv)] });

  // 11. Strongest truthful interview chance (derived) --------------------
  const byName = Object.fromEntries(gates.map((g) => [g.gate, g.pass]));
  const reasons: string[] = [];
  const firstExp = (r.experience ?? [])[0];
  const leadsWithEvidence = !firstExp || [...skillsIn((firstExp.bullets ?? []).join("\n"))].some((s) => jdSkills.has(s));
  if (!leadsWithEvidence) reasons.push("first experience entry shows no JD-relevant evidence");
  let chance: ResumeReport["interview_chance"];
  if (!byName.factual_fidelity || !byName.detail_fidelity || !byName.projects_vs_employment || !byName.career_gap) {
    chance = "weak";
    reasons.push("contains a claim a recruiter or interviewer could disprove");
  } else if (byName.ats_keywords && byName.seniority_calibration && byName.section_completeness && byName.summary_framing && leadsWithEvidence) {
    chance = "strong";
  } else {
    chance = "adequate";
    if (!byName.ats_keywords) reasons.push("truthful keyword coverage incomplete");
    if (!byName.seniority_calibration) reasons.push("level signalling miscalibrated");
    if (!byName.section_completeness) reasons.push("sections incomplete");
    if (!byName.summary_framing) reasons.push("summary does not say who the candidate is");
  }

  const unsupported = fid.length;
  return {
    gates,
    metrics: {
      claims_checked: claims,
      unsupported_claims: unsupported,
      unsupported_claim_rate: ratio(unsupported, claims),
      keyword_precision: precision,
      keyword_recall: recall,
      ats_score: score,
      word_count: words,
    },
    interview_chance: chance,
    interview_reasons: reasons,
  };
}
