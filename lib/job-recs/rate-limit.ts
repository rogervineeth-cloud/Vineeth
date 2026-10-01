// Per-instance, fixed-window request limiter for the job-recommendation API.
//
// It is a first line only: serverless instances do not share memory, so the
// durable limit on the expensive step (creating a run, i.e. calling the
// provider) is enforced in the database by record_job_rec_run (migration
// 017). This one blunts bursts of cheap calls (save / dismiss / consent).

export type Limit = { max: number; windowMs: number };
export const LIMITS = {
  create: { max: 6, windowMs: 60_000 },
  mutate: { max: 60, windowMs: 60_000 },
  read: { max: 120, windowMs: 60_000 },
} as const satisfies Record<string, Limit>;

/** Durable limit on created runs per user per rolling hour (database). */
export const MAX_RUNS_PER_HOUR = 5;

const MAX_KEYS = 10_000;
const windows = new Map<string, { start: number; count: number }>();

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

export function hit(key: string, limit: Limit, now = Date.now()): LimitResult {
  const w = windows.get(key);
  if (!w || now - w.start >= limit.windowMs) {
    if (windows.size >= MAX_KEYS) windows.clear();
    windows.set(key, { start: now, count: 1 });
    return { ok: true };
  }
  if (w.count >= limit.max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + limit.windowMs - now) / 1000)) };
  }
  w.count++;
  return { ok: true };
}

/** Tests only. */
export function resetRateLimits() {
  windows.clear();
}
