// Server-only persistence for job recommendations. The route talks to this
// interface; production uses Supabase with the service role (writes go
// through the migration-016 functions), tests use an in-memory double.
//
// Every method is scoped by the caller's user id, taken from the verified
// session — never from the request body.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/job-recs/profile";
import type { RecStatus, RunView } from "@/lib/job-recs/types";

export type StoredItem = {
  provider_job_id: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  apply_url: string;
  posted_at: string | null;
  score: number;
  components: Record<string, unknown>;
};

export type RecordRunInput = {
  userId: string;
  requestKey: string;
  provider: string;
  scoringVersion: string;
  fingerprint: string;
  status: RunView["status"];
  dropped: number;
  items: StoredItem[];
  maxPerHour: number;
};

export type CheckOutcome =
  | { outcome: "ok" }
  | { outcome: "replay"; runId: string }
  | { outcome: "rate_limited"; retryAfter: number };

export type RecordOutcome =
  | { outcome: "created" | "replay"; runId: string }
  | { outcome: "rate_limited" | "consent_required" };

export interface JobRecStore {
  getConsent(userId: string): Promise<{ version: string } | null>;
  grantConsent(userId: string, version: string): Promise<void>;
  revokeConsent(userId: string): Promise<void>;
  loadProfile(userId: string): Promise<ProfileRow | null>;
  checkRun(userId: string, requestKey: string, maxPerHour: number): Promise<CheckOutcome>;
  recordRun(input: RecordRunInput): Promise<RecordOutcome>;
  latestRun(userId: string): Promise<RunView | null>;
  loadRun(userId: string, runId: string): Promise<RunView | null>;
  setStatus(userId: string, recId: string, status: RecStatus): Promise<boolean>;
}

const RUN_COLUMNS = "id, created_at, status, dropped_count, scoring_version";
const REC_COLUMNS = "id, title, company, location, remote, apply_url, posted_at, score, status, scoring_version, components";

function fail(what: string, error: { message: string } | null): never {
  // The message is PostgREST's, not user data.
  throw new Error(`job-recs store: ${what} failed${error ? `: ${error.message}` : ""}`);
}

export function supabaseJobRecStore(getClient: () => Promise<SupabaseClient> = createServiceClient): JobRecStore {
  async function runView(svc: SupabaseClient, userId: string, run: Record<string, unknown> | null): Promise<RunView | null> {
    if (!run) return null;
    const { data, error } = await svc
      .from("job_recommendations")
      .select(REC_COLUMNS)
      .eq("user_id", userId)
      .eq("run_id", run.id as string)
      .neq("status", "dismissed")
      .order("score", { ascending: false })
      .order("provider_job_id", { ascending: true });
    if (error) fail("load recommendations", error);
    return { ...(run as Omit<RunView, "recommendations">), recommendations: (data ?? []) as unknown as RunView["recommendations"] };
  }

  return {
    async getConsent(userId) {
      const svc = await getClient();
      const { data, error } = await svc.from("job_rec_consents").select("consent_version").eq("user_id", userId).maybeSingle();
      if (error) fail("load consent", error);
      return data ? { version: data.consent_version as string } : null;
    },
    async grantConsent(userId, version) {
      const svc = await getClient();
      const { error } = await svc.rpc("grant_job_rec_consent", { p_user_id: userId, p_version: version });
      if (error) fail("grant consent", error);
    },
    async revokeConsent(userId) {
      const svc = await getClient();
      const { error } = await svc.rpc("revoke_job_rec_consent", { p_user_id: userId });
      if (error) fail("revoke consent", error);
    },
    async loadProfile(userId) {
      const svc = await getClient();
      // Only the columns matching needs. Name, email, phone, graduation year
      // are never selected.
      const { data, error } = await svc.from("profiles").select("target_roles, current_city, profile_data").eq("user_id", userId).maybeSingle();
      if (error) fail("load profile", error);
      return (data as ProfileRow | null) ?? null;
    },
    async checkRun(userId, requestKey, maxPerHour) {
      const svc = await getClient();
      const { data, error } = await svc.rpc("check_job_rec_run", { p_user_id: userId, p_request_key: requestKey, p_max_per_hour: maxPerHour });
      if (error) fail("check run", error);
      const r = (Array.isArray(data) ? data[0] : data) as { outcome: string; run_id: string | null; retry_after: number } | undefined;
      if (r?.outcome === "replay" && r.run_id) return { outcome: "replay", runId: r.run_id };
      if (r?.outcome === "rate_limited") return { outcome: "rate_limited", retryAfter: r.retry_after };
      if (r?.outcome === "ok") return { outcome: "ok" };
      fail("check run (unexpected reply)", null);
    },
    async recordRun(i) {
      const svc = await getClient();
      const { data, error } = await svc.rpc("record_job_rec_run", {
        p_user_id: i.userId, p_request_key: i.requestKey, p_provider: i.provider,
        p_scoring_version: i.scoringVersion, p_fingerprint: i.fingerprint, p_status: i.status,
        p_dropped: i.dropped, p_items: i.items, p_max_per_hour: i.maxPerHour,
      });
      if (error) fail("record run", error);
      const r = (Array.isArray(data) ? data[0] : data) as { outcome: string; run_id: string | null } | undefined;
      if ((r?.outcome === "created" || r?.outcome === "replay") && r.run_id) return { outcome: r.outcome, runId: r.run_id };
      if (r?.outcome === "rate_limited" || r?.outcome === "consent_required") return { outcome: r.outcome };
      fail("record run (unexpected reply)", null);
    },
    async latestRun(userId) {
      const svc = await getClient();
      const { data, error } = await svc.from("job_rec_runs").select(RUN_COLUMNS).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) fail("load latest run", error);
      return runView(svc, userId, data);
    },
    async loadRun(userId, runId) {
      const svc = await getClient();
      const { data, error } = await svc.from("job_rec_runs").select(RUN_COLUMNS).eq("user_id", userId).eq("id", runId).maybeSingle();
      if (error) fail("load run", error);
      return runView(svc, userId, data);
    },
    async setStatus(userId, recId, status) {
      const svc = await getClient();
      const { data, error } = await svc.rpc("set_job_rec_status", { p_user_id: userId, p_rec_id: recId, p_status: status });
      if (error) fail("set status", error);
      return data === true;
    },
  };
}
