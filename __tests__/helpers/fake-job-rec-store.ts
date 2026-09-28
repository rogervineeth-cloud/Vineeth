/**
 * In-memory double of the migration-016 store (lib/job-recs/store.ts), with
 * the same semantics as the SQL functions: consent gate, idempotency by
 * (user, request_key), rolling-hour run limit, dismissed jobs left out of new
 * runs, saved jobs kept saved, and owner-scoped status changes. The SQL itself
 * is tested against a real PostgreSQL in job-recs-migration-sql.test.ts.
 */
import { randomUUID } from "crypto";
import type { JobRecStore, RecordRunInput, StoredItem } from "@/lib/job-recs/store";
import type { ProfileRow } from "@/lib/job-recs/profile";
import type { RecStatus, RunView } from "@/lib/job-recs/types";

type Run = Omit<RunView, "recommendations"> & { user_id: string; request_key: string; fingerprint: string; at: number };
type Rec = StoredItem & { id: string; run_id: string; user_id: string; provider: string; status: RecStatus; scoring_version: string };

export function createFakeJobRecStore() {
  const consents = new Map<string, string>();
  const profiles = new Map<string, ProfileRow>();
  const runs: Run[] = [];
  const recs: Rec[] = [];
  let clock = Date.parse("2026-09-28T10:00:00Z");
  const calls: string[] = [];

  const view = (userId: string, run: Run | undefined): RunView | null => {
    if (!run || run.user_id !== userId) return null;
    const { id, created_at, status, dropped_count, scoring_version } = run;
    return {
      id, created_at, status, dropped_count, scoring_version,
      recommendations: recs
        .filter((r) => r.run_id === run.id && r.status !== "dismissed")
        .sort((a, b) => b.score - a.score || a.provider_job_id.localeCompare(b.provider_job_id))
        .map((r) => ({
          id: r.id, title: r.title, company: r.company, location: r.location, remote: r.remote,
          apply_url: r.apply_url, posted_at: r.posted_at, score: r.score, status: r.status,
          scoring_version: r.scoring_version, components: r.components as RunView["recommendations"][number]["components"],
        })),
    };
  };
  const recent = (userId: string) => runs.filter((r) => r.user_id === userId && r.at > clock - 3_600_000);

  const store: JobRecStore = {
    async getConsent(u) { calls.push("getConsent"); const v = consents.get(u); return v ? { version: v } : null; },
    async grantConsent(u, v) { calls.push("grantConsent"); consents.set(u, v); },
    async revokeConsent(u) {
      calls.push("revokeConsent");
      consents.delete(u);
      for (let i = runs.length - 1; i >= 0; i--) if (runs[i].user_id === u) runs.splice(i, 1);
      for (let i = recs.length - 1; i >= 0; i--) if (recs[i].user_id === u) recs.splice(i, 1);
    },
    async loadProfile(u) { calls.push("loadProfile"); return profiles.get(u) ?? null; },
    async checkRun(u, key, max) {
      calls.push("checkRun");
      const existing = runs.find((r) => r.user_id === u && r.request_key === key);
      if (existing) return { outcome: "replay", runId: existing.id };
      const rr = recent(u);
      if (rr.length >= max) return { outcome: "rate_limited", retryAfter: Math.ceil((rr[0].at + 3_600_000 - clock) / 1000) };
      return { outcome: "ok" };
    },
    async recordRun(i: RecordRunInput) {
      calls.push("recordRun");
      if (!consents.has(i.userId)) return { outcome: "consent_required" };
      const existing = runs.find((r) => r.user_id === i.userId && r.request_key === i.requestKey);
      if (existing) return { outcome: "replay", runId: existing.id };
      if (recent(i.userId).length >= i.maxPerHour) return { outcome: "rate_limited" };
      const prev = (id: string) => recs.filter((r) => r.user_id === i.userId && r.provider === i.provider && r.provider_job_id === id);
      const run: Run = {
        id: randomUUID(), user_id: i.userId, request_key: i.requestKey, fingerprint: i.fingerprint, at: clock,
        created_at: new Date(clock).toISOString(), status: i.status, dropped_count: i.dropped, scoring_version: i.scoringVersion,
      };
      runs.push(run);
      for (const item of i.items) {
        const p = prev(item.provider_job_id);
        if (p.some((r) => r.status === "dismissed")) continue;
        recs.push({ ...item, id: randomUUID(), run_id: run.id, user_id: i.userId, provider: i.provider,
          scoring_version: i.scoringVersion, status: p.some((r) => r.status === "saved") ? "saved" : "new" });
      }
      return { outcome: "created", runId: run.id };
    },
    async latestRun(u) { calls.push("latestRun"); return view(u, [...runs].reverse().find((r) => r.user_id === u)); },
    async loadRun(u, id) { calls.push("loadRun"); return view(u, runs.find((r) => r.id === id)); },
    async setStatus(u, id, status) {
      calls.push("setStatus");
      const r = recs.find((x) => x.id === id && x.user_id === u);
      if (!r) return false;
      r.status = status;
      return true;
    },
  };

  return {
    store,
    calls,
    runs,
    recs,
    setProfile: (u: string, p: ProfileRow) => profiles.set(u, p),
    advance: (ms: number) => { clock += ms; },
  };
}
