// The contract every job source implements. Adapters run on the server only,
// are selected from the allowlist in lib/job-recs/config.ts, and receive the
// minimal ProviderQuery (titles + skills) — never a resume, contact details or
// user identifiers.

import { z } from "zod";
import type { ProviderQuery } from "@/lib/job-recs/profile";
import type { ProviderId } from "@/lib/job-recs/config";
import { validApplyUrl } from "@/lib/job-recs/apply-url";

/** One job after normalisation: the only fields we keep from a provider. */
export type NormalizedJob = {
  provider_job_id: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  apply_url: string;
  posted_at: string | null;
  required_skills: string[];
  min_years: number | null;
  max_years: number | null;
};

export type ProviderResult = {
  /** The provider's raw items. Normalised immediately; never stored or logged. */
  items: unknown[];
  /** The provider said the result set is incomplete (timeout, page cap, ...). */
  incomplete?: boolean;
};

export interface JobProviderAdapter {
  readonly id: ProviderId;
  search(query: ProviderQuery, opts: { signal?: AbortSignal }): Promise<ProviderResult>;
}

const text = (max: number) => z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(max));

const jobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(128)),
  title: text(160),
  company: text(160),
  location: text(120).nullable().optional(),
  remote: z.boolean().optional(),
  apply_url: z.string(),
  posted_at: z.string().datetime({ offset: true }).nullable().optional(),
  skills: z.array(z.string()).max(50).optional(),
  min_years: z.number().int().min(0).max(50).nullable().optional(),
  max_years: z.number().int().min(0).max(50).nullable().optional(),
});

/**
 * Picks the allowed fields out of one raw provider item. Returns null for
 * anything malformed — including a non-HTTPS apply link — so the caller can
 * count it as dropped. Unknown fields are discarded, not carried along.
 */
export function normalizeJob(raw: unknown): NormalizedJob | null {
  const parsed = jobSchema.safeParse(raw);
  if (!parsed.success) return null;
  const j = parsed.data;
  const apply_url = validApplyUrl(j.apply_url);
  if (!apply_url) return null;
  const min = j.min_years ?? null;
  const max = j.max_years ?? null;
  if (min !== null && max !== null && max < min) return null;
  const skills = (j.skills ?? [])
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0 && s.length <= 60)
    .slice(0, 30);
  return {
    provider_job_id: j.id,
    title: j.title,
    company: j.company,
    location: j.location ?? null,
    remote: j.remote ?? false,
    apply_url,
    posted_at: j.posted_at ?? null,
    required_skills: skills,
    min_years: min,
    max_years: max,
  };
}

export type NormalizedBatch = { jobs: NormalizedJob[]; dropped: number; incomplete: boolean };

export function normalizeBatch(result: ProviderResult, maxJobs = 100): NormalizedBatch {
  const items = Array.isArray(result.items) ? result.items : [];
  const seen = new Set<string>();
  const jobs: NormalizedJob[] = [];
  let dropped = 0;
  for (const item of items.slice(0, maxJobs)) {
    const j = normalizeJob(item);
    if (!j || seen.has(j.provider_job_id)) {
      dropped++;
      continue;
    }
    seen.add(j.provider_job_id);
    jobs.push(j);
  }
  return { jobs, dropped, incomplete: Boolean(result.incomplete) || items.length > maxJobs };
}
