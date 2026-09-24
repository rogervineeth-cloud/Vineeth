// Deterministic facts about a candidate, computed from their own profile.
//
// The model was left to work out "years of experience" itself and got it
// wrong both ways: a Software Engineer with 3.2 years (Jul 2023 - Present)
// became "1+ year of professional experience", and a full-stack engineer with
// 4.3 years in the current job (5.3 in total) became "3 years". Durations are
// data, so the arithmetic is done here — once for the prompt (CANDIDATE_FACTS)
// and once to check what the model wrote.

export type FactsProfile = {
  experience?: { company: string; role: string; duration: string }[];
  education?: { institution: string; degree: string; year: string }[];
  [key: string]: unknown;
};

export type CandidateFacts = {
  /** Non-internship months, overlapping roles counted once. */
  professional_months: number;
  /** professional_months / 12, rounded DOWN to one decimal. */
  professional_years: number;
  internship_months: number;
  /** Months at each employer (non-internship), most recent employer first. */
  employer_months: { company: string; months: number }[];
  /** Most recent non-internship role title, if any. */
  current_title: string | null;
  /** The sentence a summary should open with when the model's opening lost it. */
  identity: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const INTERN = /\bintern(?:ship)?s?\b|\btrainee\b|\bapprentice\b/i;

function monthIndex(token: string, present: number): number | null {
  const t = token.trim().toLowerCase();
  if (/^(present|current|now|till date|to date)/.test(t)) return present;
  const m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1]);
    return mi < 0 ? null : Number(m[2]) * 12 + mi;
  }
  const y = t.match(/^(\d{4})$/);
  return y ? Number(y[1]) * 12 : null;
}

/** Inclusive month range of "Jul 2023 - Jun 2024" / "Jul 2024 - Present". */
export function durationMonths(duration: string, now: Date): [number, number] | null {
  const present = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const parts = (duration ?? "").replace(/[–—]/g, "-").split(/\s+-\s+|\s+to\s+/i);
  if (parts.length !== 2) return null;
  const a = monthIndex(parts[0], present);
  const b = monthIndex(parts[1], present);
  if (a === null || b === null || b < a) return null;
  return [a, Math.min(b, present)];
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function computeFacts(profile: FactsProfile, now: Date = new Date()): CandidateFacts {
  const professional = new Set<number>();
  const internship = new Set<number>();
  const byEmployer = new Map<string, { company: string; months: Set<number>; last: number }>();
  let current: { title: string; end: number } | null = null;

  for (const e of profile.experience ?? []) {
    const r = durationMonths(e.duration, now);
    if (!r) continue;
    const intern = INTERN.test(e.role);
    for (let m = r[0]; m <= r[1]; m++) (intern ? internship : professional).add(m);
    if (intern) continue;
    const k = key(e.company);
    const entry = byEmployer.get(k) ?? { company: e.company, months: new Set<number>(), last: -1 };
    for (let m = r[0]; m <= r[1]; m++) entry.months.add(m);
    entry.last = Math.max(entry.last, r[1]);
    byEmployer.set(k, entry);
    if (!current || r[1] > current.end) current = { title: e.role.trim(), end: r[1] };
  }

  const months = professional.size;
  const years = Math.floor((months / 12) * 10) / 10;
  const employer_months = [...byEmployer.values()]
    .sort((a, b) => b.last - a.last)
    .map((e) => ({ company: e.company, months: e.months.size }));

  return {
    professional_months: months,
    professional_years: years,
    internship_months: internship.size,
    employer_months,
    current_title: current?.title ?? null,
    identity: identitySentence(profile, current?.title ?? null, months, internship.size, now),
  };
}

function identitySentence(p: FactsProfile, title: string | null, months: number, internMonths: number, now: Date): string {
  if (title && months >= 12) {
    const y = Math.floor(months / 12);
    return `${title} with ${y}+ year${y === 1 ? "" : "s"} of professional experience.`;
  }
  if (title && months > 0) return `${title} with ${months} months of professional experience.`;
  const edu = [...(p.education ?? [])].sort((a, b) => endYear(b.year) - endYear(a.year))[0];
  const intern = internMonths > 0 ? ` with ${internMonths} months of internship experience` : "";
  if (edu) {
    const y = endYear(edu.year);
    const graduated = y > 0 && y <= now.getUTCFullYear();
    return `${edu.degree.trim()} ${graduated ? `graduate (${y})` : "student"}${intern}.`;
  }
  return internMonths > 0 ? `Candidate${intern}.` : "";
}

function endYear(s: string): number {
  const ys = (s ?? "").match(/\d{4}/g);
  return ys ? Number(ys[ys.length - 1]) : 0;
}

// ── Years claims ───────────────────────────────────────────────────────────

/** "3 years", "3+ years", "1 year", "3-year", "2.5 yrs". */
const YEARS = /(\d+(?:\.\d+)?)(\+)?(?:\s*|-)(?:years?|yrs?)\b/gi;
/**
 * A claim about the candidate's whole career ("of professional experience",
 * "of experience") — only the total counts. Anything else ("3 years of
 * full-stack development", "1 year of QA") may also be one employer's tenure.
 */
const OVERALL = /^\s*(?:of\s+)?(?:(?:professional|industry|total|overall|work|working)\b|experience\b)/i;

export type YearsProblem = { claim: string; kind: "understated" | "overstated" };

/**
 * Years claims in `text` that no truthful measure supports. A claim X is
 * supported by a measure M (total professional years, or one employer's
 * tenure) when floor(M) <= X <= M (+0.5 of rounding unless written "X+").
 */
export function yearsProblems(text: string, facts: CandidateFacts): YearsProblem[] {
  const total = facts.professional_months / 12;
  const tenures = facts.employer_months.map((e) => e.months / 12);
  const out: YearsProblem[] = [];
  for (const m of text.matchAll(YEARS)) {
    const x = Number(m[1]);
    const plus = Boolean(m[2]);
    const after = text.slice((m.index ?? 0) + m[0].length);
    const measures = (OVERALL.test(after) ? [total] : [total, ...tenures]).filter((v) => v > 0);
    const ok = measures.some((v) => x >= Math.floor(v) && x <= v + (plus ? 0 : 0.5));
    if (ok) continue;
    const max = Math.max(0, ...measures);
    out.push({ claim: m[0], kind: x > max ? "overstated" : "understated" });
  }
  return out;
}
