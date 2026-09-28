// Minimal, server-side matching profile for job recommendations.
//
// ONLY explicit resume facts are used, and only the ones a job match needs:
//   titles  ... target roles the user picked + role titles they entered
//   skills  ... the skills list they entered + tech they listed on projects
//   years   ... total professional years, computed from their own durations
//   city    ... their current city (kept on the server; never sent to a provider)
//
// Never read or derived here: name, email, phone, graduation year (an age
// proxy), summary, experience bullets, education, or anything inferred from
// free text. Nothing is guessed: a skill that appears only in a bullet does
// not count, because the user did not list it.
//
// The provider query built from this profile carries titles and skills only.

import { createHash } from "crypto";
import { computeFacts } from "@/lib/profile-facts";
import { cleanTargetRoles } from "@/lib/target-roles";
import { SKILL_SURFACE_TO_CANONICAL } from "@/lib/skill-lexicon";

export const MAX_TITLES = 6;
export const MAX_SKILLS = 30;
export const MAX_TERM_LENGTH = 60;
export const MIN_SKILLS = 2;

export type MatchingProfile = {
  /** Display-form titles, de-duplicated, target roles first. */
  titles: string[];
  /** Display-form skills, canonicalised where the lexicon knows them. */
  skills: string[];
  professional_years: number;
  city: string | null;
};

export type ProfileAssessment =
  | { status: "ok"; profile: MatchingProfile; fingerprint: string }
  | { status: "insufficient"; missing: ("titles" | "skills")[] };

/** The query a provider receives. Titles and skills only — nothing else. */
export type ProviderQuery = { titles: string[]; skills: string[] };

// A term that looks like contact data or a link is not a title or a skill.
const CONTACT_OR_LINK = /@|https?:|www\.|\d{7,}|\+\d{2}/i;

export const termKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();

function cleanTerm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_TERM_LENGTH || CONTACT_OR_LINK.test(t)) return null;
  return t;
}

function canonicalSkill(s: string): string {
  return SKILL_SURFACE_TO_CANONICAL.get(s.toLowerCase()) ?? s;
}

function uniqueByKey(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const k = termKey(i);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(i);
    if (out.length >= max) break;
  }
  return out;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export type ProfileRow = {
  target_roles?: unknown;
  current_city?: unknown;
  profile_data?: unknown;
};

export function buildMatchingProfile(row: ProfileRow | null | undefined, now: Date = new Date()): ProfileAssessment {
  const data = rec(row?.profile_data);

  const experience = arr(data.experience)
    .map(rec)
    .map((e) => ({
      company: typeof e.company === "string" ? e.company : "",
      role: typeof e.role === "string" ? e.role : "",
      duration: typeof e.duration === "string" ? e.duration : "",
    }))
    .filter((e) => e.role.trim());

  const titles = uniqueByKey(
    [...cleanTargetRoles(row?.target_roles), ...experience.map((e) => e.role)]
      .map(cleanTerm)
      .filter((t): t is string => t !== null),
    MAX_TITLES
  );

  const projectTech = arr(data.projects).flatMap((p) => arr(rec(p).tech));
  const skills = uniqueByKey(
    [...arr(data.skills), ...projectTech]
      .map(cleanTerm)
      .filter((t): t is string => t !== null)
      .map(canonicalSkill),
    MAX_SKILLS
  );

  const missing: ("titles" | "skills")[] = [];
  if (titles.length === 0) missing.push("titles");
  if (skills.length < MIN_SKILLS) missing.push("skills");
  if (missing.length) return { status: "insufficient", missing };

  const facts = computeFacts({ experience: experience.map((e) => ({ ...e })) }, now);
  const city = cleanTerm(row?.current_city);
  const profile: MatchingProfile = {
    titles,
    skills,
    professional_years: facts.professional_years,
    city,
  };
  return { status: "ok", profile, fingerprint: profileFingerprint(profile) };
}

/** Stable hash of the matching inputs. Stored instead of the inputs themselves. */
export function profileFingerprint(p: MatchingProfile): string {
  const canonical = JSON.stringify({
    t: p.titles.map(termKey).sort(),
    s: p.skills.map(termKey).sort(),
    y: p.professional_years,
    c: p.city ? termKey(p.city) : null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function providerQuery(p: MatchingProfile): ProviderQuery {
  return { titles: [...p.titles], skills: [...p.skills] };
}
