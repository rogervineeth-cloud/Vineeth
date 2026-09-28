// Deterministic job-match scoring, version v1.
//
// Same profile + same jobs → same scores, same order, same explanations. No
// model call, no randomness, no clock. Every component is stored with its
// score, weight and a plain-language reason, so the UI can say exactly why a
// job was suggested and the numbers can be audited later.
//
//   skills      50%  share of the job's listed skills the user listed too
//   title       30%  best word overlap between the job title and the user's
//                    target roles / past role titles
//   experience  15%  user's total professional years vs the job's stated range
//   location     5%  remote, or same city as the user's current city
//
// Unknowns (a job with no listed skills, no experience range, no location)
// score a neutral 0.5 and say so, rather than being guessed either way.

import { SKILL_SURFACE_TO_CANONICAL } from "@/lib/skill-lexicon";
import { termKey, type MatchingProfile } from "@/lib/job-recs/profile";
import type { NormalizedJob } from "@/lib/job-recs/providers/types";

export const SCORING_VERSION = "v1";
export const WEIGHTS = { skills: 0.5, title: 0.3, experience: 0.15, location: 0.05 } as const;
export const MAX_RESULTS = 20;
/** A job must match at least this much on skills or title to be shown at all. */
const MIN_TITLE_OVERLAP = 0.34;

export type ComponentName = keyof typeof WEIGHTS;

export type ScoreComponent = {
  score: number; // 0..1, rounded to 2 dp
  weight: number;
  reason: string;
  matched?: string[];
  missing?: string[];
};

export type ScoredJob = {
  job: NormalizedJob;
  score: number; // 0..100 integer
  components: Record<ComponentName, ScoreComponent>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const skillKey = (s: string) => termKey(SKILL_SURFACE_TO_CANONICAL.get(s.toLowerCase()) ?? s);

const TITLE_STOPWORDS = new Set(["and", "of", "the", "a", "an", "for", "in", "at", "to", "i", "ii", "iii", "sr", "jr", "senior", "junior", "lead", "associate"]);
function titleTokens(s: string): Set<string> {
  return new Set(termKey(s).split(" ").filter((t) => t && !TITLE_STOPWORDS.has(t)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function skillsComponent(p: MatchingProfile, job: NormalizedJob): ScoreComponent {
  const w = WEIGHTS.skills;
  if (job.required_skills.length === 0) {
    return { score: 0.5, weight: w, reason: "The job does not list specific skills.", matched: [], missing: [] };
  }
  const mine = new Set(p.skills.map(skillKey));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const s of job.required_skills) (mine.has(skillKey(s)) ? matched : missing).push(s);
  const score = matched.length / job.required_skills.length;
  const reason = matched.length
    ? `You list ${matched.length} of the ${job.required_skills.length} skills this job asks for.`
    : `None of the ${job.required_skills.length} skills this job asks for are on your resume.`;
  return { score: round2(score), weight: w, reason, matched, missing };
}

function titleComponent(p: MatchingProfile, job: NormalizedJob): ScoreComponent {
  const w = WEIGHTS.title;
  const jt = titleTokens(job.title);
  let best = 0;
  let bestTitle: string | null = null;
  for (const t of p.titles) {
    const s = jaccard(jt, titleTokens(t));
    if (s > best) {
      best = s;
      bestTitle = t;
    }
  }
  const reason = bestTitle
    ? `The job title is similar to "${bestTitle}" from your resume.`
    : "The job title does not match your target roles or past roles.";
  return { score: round2(best), weight: w, reason, matched: bestTitle ? [bestTitle] : [] };
}

function experienceComponent(p: MatchingProfile, job: NormalizedJob): ScoreComponent {
  const w = WEIGHTS.experience;
  const y = p.professional_years;
  const { min_years: min, max_years: max } = job;
  if (min === null && max === null) {
    return { score: 0.5, weight: w, reason: "The job does not state an experience range." };
  }
  const range = min !== null && max !== null ? `${min}-${max} years` : min !== null ? `${min}+ years` : `up to ${max} years`;
  if (min !== null && y < min) {
    const score = Math.max(0, 1 - (min - y) / 3);
    return { score: round2(score), weight: w, reason: `The job asks for ${range}; your resume shows ${y}.` };
  }
  if (max !== null && y > max) {
    const score = Math.max(0.5, 1 - (y - max) / 10);
    return { score: round2(score), weight: w, reason: `The job asks for ${range}; your resume shows ${y}, which is more.` };
  }
  return { score: 1, weight: w, reason: `Your ${y} years of experience fit the job's ${range}.` };
}

function locationComponent(p: MatchingProfile, job: NormalizedJob): ScoreComponent {
  const w = WEIGHTS.location;
  if (job.remote) return { score: 1, weight: w, reason: "The job is remote." };
  if (!job.location) return { score: 0.5, weight: w, reason: "The job does not state a location." };
  if (!p.city) return { score: 0.5, weight: w, reason: `The job is in ${job.location}; your profile has no city.` };
  if (termKey(job.location) === termKey(p.city)) return { score: 1, weight: w, reason: `The job is in your city, ${job.location}.` };
  return { score: 0, weight: w, reason: `The job is in ${job.location}.` };
}

export function scoreJob(p: MatchingProfile, job: NormalizedJob): ScoredJob {
  const components = {
    skills: skillsComponent(p, job),
    title: titleComponent(p, job),
    experience: experienceComponent(p, job),
    location: locationComponent(p, job),
  };
  const total = (Object.keys(WEIGHTS) as ComponentName[]).reduce((sum, k) => sum + components[k].score * WEIGHTS[k], 0);
  return { job, score: Math.round(total * 100), components };
}

/** Scores, filters out jobs with no skill or title relevance, sorts, caps. */
export function rankJobs(p: MatchingProfile, jobs: NormalizedJob[], max = MAX_RESULTS): ScoredJob[] {
  return jobs
    .map((j) => scoreJob(p, j))
    .filter((s) => (s.components.skills.matched?.length ?? 0) > 0 || s.components.title.score >= MIN_TITLE_OVERLAP)
    .sort((a, b) => b.score - a.score || a.job.provider_job_id.localeCompare(b.job.provider_job_id))
    .slice(0, max);
}
