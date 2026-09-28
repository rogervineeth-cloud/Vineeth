// Server-only. Feature flags and provider selection for AI Job Recommendations
// (Phase 1).
//
// Default: OFF. Nothing about job recommendations is reachable unless
// JOB_RECOMMENDATIONS_ENABLED=true is set on the server:
//   - /job-recommendations           → 404
//   - /api/job-recommendations/*     → 404
//
// JOB_RECOMMENDATIONS_PROVIDER picks the job source from a server-side
// allowlist. Phase 1 ships exactly one adapter, the deterministic `fixture`,
// which is for development and tests only:
//   - fixture in production        → hard failure (FixtureInProductionError);
//                                    it must never serve made-up jobs to users.
//   - no provider / unknown value  → "unavailable": the page says honestly that
//                                    recommendations are not available yet.
// No provider credentials are read here or anywhere in Phase 1.

export const APPROVED_PROVIDERS = ["fixture"] as const;
export type ProviderId = (typeof APPROVED_PROVIDERS)[number];

/** Bumped when the stored consent text changes; older consents must be re-given. */
export const CONSENT_VERSION = "2026-09-v1";

export type JobRecsEnv = Record<string, string | undefined>;

export class FixtureInProductionError extends Error {
  constructor() {
    super("job-recs: the fixture provider must never run in production");
    this.name = "FixtureInProductionError";
  }
}

/**
 * Production means any production runtime, including `next start` on a
 * laptop: VERCEL_ENV=production, or NODE_ENV=production. Deliberately
 * conservative — the only cost of a false positive is that the fixture
 * refuses to run.
 */
export function isProductionRuntime(env: JobRecsEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

export function isJobRecsEnabled(env: JobRecsEnv = process.env): boolean {
  return env.JOB_RECOMMENDATIONS_ENABLED === "true";
}

export type ProviderResolution =
  | { status: "ready"; provider: ProviderId }
  | { status: "unavailable" };

/**
 * Which approved provider serves this runtime. Throws FixtureInProductionError
 * when the fixture is selected in production; never silently falls back to it.
 */
export function resolveProvider(env: JobRecsEnv = process.env): ProviderResolution {
  const raw = (env.JOB_RECOMMENDATIONS_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "none") return { status: "unavailable" };
  if (!(APPROVED_PROVIDERS as readonly string[]).includes(raw)) return { status: "unavailable" };
  const provider = raw as ProviderId;
  if (provider === "fixture" && isProductionRuntime(env)) throw new FixtureInProductionError();
  return { status: "ready", provider };
}
