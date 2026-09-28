// Server-only orchestration for AI Job Recommendations (Phase 1). The routes
// authenticate the caller and validate input; everything after that lives
// here so it can be tested offline with an in-memory store and the fixture.
//
// Privacy rules enforced in this file:
//   * the provider receives providerQuery(profile) — titles and skills only;
//   * provider items are normalised immediately and never stored or logged;
//   * logs carry event names, codes and counts only — no user content.

import {
  CONSENT_VERSION,
  FixtureInProductionError,
  resolveProvider,
  type JobRecsEnv,
  type ProviderId,
} from "@/lib/job-recs/config";
import { buildMatchingProfile, providerQuery } from "@/lib/job-recs/profile";
import { createProvider } from "@/lib/job-recs/providers/registry";
import { normalizeBatch, type JobProviderAdapter } from "@/lib/job-recs/providers/types";
import { MAX_RUNS_PER_HOUR } from "@/lib/job-recs/rate-limit";
import { rankJobs, SCORING_VERSION } from "@/lib/job-recs/scoring";
import type { JobRecStore, StoredItem } from "@/lib/job-recs/store";
import type { JobRecsResponse, RecStatus, RunView } from "@/lib/job-recs/types";

export const PROVIDER_TIMEOUT_MS = 8_000;

export type ServiceDeps = {
  store: JobRecStore;
  env?: JobRecsEnv;
  providerFactory?: (id: ProviderId, env: JobRecsEnv) => JobProviderAdapter;
};

export type ErrorBody = { error: string; code: string; retry_after?: number };
export type ServiceResult = {
  status: number;
  body: JobRecsResponse | ErrorBody | { id: string; status: RecStatus };
  headers?: Record<string, string>;
};

/** Event name + code + counts. Never user content, never provider payloads. */
export function logEvent(event: string, fields: Record<string, string | number | boolean> = {}) {
  console.info(`[job-recs] ${event}`, fields);
}

const MISCONFIGURED: ServiceResult = {
  status: 500,
  body: { error: "Job recommendations are misconfigured on this server.", code: "provider_misconfigured" },
};

type Gate =
  | { kind: "stop"; result: ServiceResult }
  | { kind: "go"; provider: ProviderId; consent: JobRecsResponse["consent"] };

async function gate(userId: string, deps: ServiceDeps, forCreate: boolean): Promise<Gate> {
  const env = deps.env ?? process.env;
  let resolution;
  try {
    resolution = resolveProvider(env);
  } catch (err) {
    if (err instanceof FixtureInProductionError) {
      logEvent("provider_misconfigured", { code: "fixture_in_production" });
      return { kind: "stop", result: MISCONFIGURED };
    }
    throw err;
  }
  const notGranted = { granted: false, version: CONSENT_VERSION };
  if (resolution.status === "unavailable") {
    return { kind: "stop", result: { status: forCreate ? 503 : 200, body: { state: "unavailable", consent: notGranted } } };
  }
  const consent = await deps.store.getConsent(userId);
  if (consent?.version !== CONSENT_VERSION) {
    return { kind: "stop", result: { status: forCreate ? 403 : 200, body: { state: "consent_required", consent: notGranted } } };
  }
  return { kind: "go", provider: resolution.provider, consent: { granted: true, version: CONSENT_VERSION } };
}

function fromRun(run: RunView, consent: JobRecsResponse["consent"]): JobRecsResponse {
  const state = run.recommendations.length === 0 ? "empty" : run.status === "partial" ? "partial" : "results";
  return { state, consent, run };
}

export async function getJobRecs(userId: string, deps: ServiceDeps): Promise<ServiceResult> {
  const g = await gate(userId, deps, false);
  if (g.kind === "stop") return g.result;
  const assessment = buildMatchingProfile(await deps.store.loadProfile(userId));
  const run = await deps.store.latestRun(userId);
  if (run) return { status: 200, body: fromRun(run, g.consent) };
  if (assessment.status === "insufficient") {
    return { status: 200, body: { state: "insufficient_resume", consent: g.consent, missing: assessment.missing } };
  }
  return { status: 200, body: { state: "ready", consent: g.consent } };
}

function rateLimited(retryAfter: number): ServiceResult {
  return {
    status: 429,
    body: { error: "You have asked for recommendations too often. Please try again later.", code: "rate_limited", retry_after: retryAfter },
    headers: { "Retry-After": String(retryAfter) },
  };
}

export async function createJobRecs(userId: string, requestKey: string, deps: ServiceDeps): Promise<ServiceResult> {
  const env = deps.env ?? process.env;
  const g = await gate(userId, deps, true);
  if (g.kind === "stop") return g.result;

  const check = await deps.store.checkRun(userId, requestKey, MAX_RUNS_PER_HOUR);
  if (check.outcome === "replay") {
    const run = await deps.store.loadRun(userId, check.runId);
    if (run) return { status: 200, body: fromRun(run, g.consent) };
  }
  if (check.outcome === "rate_limited") {
    logEvent("rate_limited", { layer: "db" });
    return rateLimited(check.retryAfter);
  }

  const assessment = buildMatchingProfile(await deps.store.loadProfile(userId));
  if (assessment.status === "insufficient") {
    return { status: 422, body: { state: "insufficient_resume", consent: g.consent, missing: assessment.missing } };
  }

  let adapter: JobProviderAdapter;
  let raw;
  try {
    adapter = (deps.providerFactory ?? createProvider)(g.provider, env);
    raw = await adapter.search(providerQuery(assessment.profile), { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof FixtureInProductionError) {
      logEvent("provider_misconfigured", { code: "fixture_in_production" });
      return MISCONFIGURED;
    }
    logEvent("provider_error", { provider: g.provider });
    return { status: 502, body: { error: "The job source did not respond. Please try again in a few minutes.", code: "provider_error" } };
  }

  const batch = normalizeBatch(raw);
  const ranked = rankJobs(assessment.profile, batch.jobs);
  const status: RunView["status"] = ranked.length === 0 ? "empty" : batch.incomplete || batch.dropped > 0 ? "partial" : "results";
  const items: StoredItem[] = ranked.map((r) => ({
    provider_job_id: r.job.provider_job_id,
    title: r.job.title,
    company: r.job.company,
    location: r.job.location,
    remote: r.job.remote,
    apply_url: r.job.apply_url,
    posted_at: r.job.posted_at,
    score: r.score,
    components: r.components,
  }));

  const recorded = await deps.store.recordRun({
    userId, requestKey, provider: g.provider, scoringVersion: SCORING_VERSION,
    fingerprint: assessment.fingerprint, status, dropped: batch.dropped, items, maxPerHour: MAX_RUNS_PER_HOUR,
  });
  if (!("runId" in recorded)) {
    if (recorded.outcome === "rate_limited") return rateLimited(60);
    return { status: 403, body: { state: "consent_required", consent: { granted: false, version: CONSENT_VERSION } } };
  }
  logEvent("run_recorded", { provider: g.provider, status, results: items.length, dropped: batch.dropped, replay: recorded.outcome === "replay" });
  const run = await deps.store.loadRun(userId, recorded.runId);
  if (!run) throw new Error("job-recs: recorded run could not be loaded");
  return { status: recorded.outcome === "created" ? 201 : 200, body: fromRun(run, g.consent) };
}

export async function setConsent(userId: string, action: "grant" | "revoke", deps: ServiceDeps): Promise<ServiceResult> {
  if (action === "grant") await deps.store.grantConsent(userId, CONSENT_VERSION);
  else await deps.store.revokeConsent(userId);
  logEvent(action === "grant" ? "consent_granted" : "consent_revoked");
  return getJobRecs(userId, deps);
}

export async function setRecStatus(userId: string, recId: string, status: RecStatus, deps: ServiceDeps): Promise<ServiceResult> {
  const g = await gate(userId, deps, true);
  if (g.kind === "stop") return g.result;
  const ok = await deps.store.setStatus(userId, recId, status);
  if (!ok) return { status: 404, body: { error: "Recommendation not found.", code: "not_found" } };
  return { status: 200, body: { id: recId, status } };
}
