// Server-only. Idempotent resume generation — see
// supabase/migrations/013_generation_idempotency.sql for the guarantees.
//
// The route calls begin() before the model, then complete() (charge + insert
// + mark done, one transaction) or fail() (release the lock). The store is
// an interface so route tests can run the same flow against an in-memory
// double; the real one calls the migration's RPCs with the service client.

import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { normaliseJd } from "@/lib/regen";

/** How long an attempt holds its lock if the server dies mid-request. The route's maxDuration is 60 s. */
export const GENERATION_LEASE_SECONDS = 150;

export type BeginOutcome =
  | { outcome: "started" }
  | { outcome: "replay"; resumeId: string }
  | { outcome: "in_progress" }
  | { outcome: "key_reused" };

export type CompleteOutcome =
  | { outcome: "completed"; resumeId: string }
  | { outcome: "replay"; resumeId: string }
  | { outcome: "payment_required" }
  | { outcome: "expired" }
  | { outcome: "unknown_request" };

/** The resumes row the server writes (it used to be written by the browser). */
export type GeneratedResumeRow = {
  jd_text: string;
  resume_json: unknown;
  ats_score: number;
  tailored_role: string;
  matched_keywords: string[];
  missing_keywords: string[];
  contact_snapshot: { full_name: string; email: string; phone: string; current_city: string };
  template: string | null;
  regen_of_resume_id: string | null;
};

export type StoredResume = { id: string; resume_json: unknown; regen_of_resume_id: string | null };

export interface GenerationStore {
  begin(userId: string, requestKey: string, fingerprint: string): Promise<BeginOutcome>;
  complete(userId: string, requestKey: string, charge: boolean, row: GeneratedResumeRow): Promise<CompleteOutcome>;
  fail(userId: string, requestKey: string, reason: string): Promise<void>;
  /** A resume this user owns (for replays), or null. */
  load(userId: string, resumeId: string): Promise<StoredResume | null>;
}

/** JSON with object keys sorted at every level, so equal requests hash equally. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * What makes two generation requests "the same" for the in-flight lock: the
 * job description, whitespace- and case-normalised. Nothing else. Computed on
 * the server — never supplied by the client.
 *
 * It used to hash the whole request (template, keyword chips, the profile as
 * the tab loaded it, the regeneration parent from the URL, and the JD). Each
 * tab holds its own copy of all of those, so two tabs pasting the same JD
 * rarely sent byte-identical requests: a different template, one removed
 * keyword chip, a tab opened from a "Regenerate" link, or a profile loaded
 * before an edit gave a different fingerprint, the partial unique index never
 * saw a conflict, and both tabs were generated and charged. Found in live QA:
 * two tabs, same Junior Data Analyst JD, two credits, two resumes.
 *
 * One generation per JD in flight per user is the intent the lock protects. A
 * deliberate second generation of the same JD (another template, say) is
 * still allowed once the first finishes; only a concurrent one gets 409.
 *
 * The same value backs the "key reused for a different request" check, which
 * is now per JD. The browser reuses a request_key only for a byte-identical
 * retry, so that check loses nothing it relied on.
 */
export function generationFingerprint(jdText: string): string {
  const canonical = stableStringify({ v: 2, jd: normaliseJd(jdText).toLowerCase() });
  return createHash("sha256").update(canonical).digest("hex");
}

type RpcRow = { outcome: string; resume_id: string | null };

function firstRow(data: unknown): RpcRow {
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined;
  if (!row || typeof row.outcome !== "string") throw new Error("generation store: empty RPC result");
  return row;
}

/** The real store: migration 013's RPCs, called as service_role. */
export function supabaseGenerationStore(): GenerationStore {
  return {
    async begin(userId, requestKey, fingerprint) {
      const svc = await createServiceClient();
      const { data, error } = await svc.rpc("begin_resume_generation", {
        p_user_id: userId, p_request_key: requestKey, p_fingerprint: fingerprint, p_lease_seconds: GENERATION_LEASE_SECONDS,
      });
      if (error) throw new Error(`begin_resume_generation: ${error.message}`);
      const row = firstRow(data);
      if (row.outcome === "replay" && row.resume_id) return { outcome: "replay", resumeId: row.resume_id };
      if (row.outcome === "started" || row.outcome === "in_progress" || row.outcome === "key_reused") return { outcome: row.outcome };
      throw new Error(`begin_resume_generation: unexpected outcome ${row.outcome}`);
    },
    async complete(userId, requestKey, charge, resumeRow) {
      const svc = await createServiceClient();
      const { data, error } = await svc.rpc("complete_resume_generation", {
        p_user_id: userId, p_request_key: requestKey, p_charge: charge, p_resume: resumeRow,
      });
      if (error) throw new Error(`complete_resume_generation: ${error.message}`);
      const row = firstRow(data);
      if ((row.outcome === "completed" || row.outcome === "replay") && row.resume_id) return { outcome: row.outcome, resumeId: row.resume_id };
      if (row.outcome === "payment_required" || row.outcome === "expired" || row.outcome === "unknown_request") return { outcome: row.outcome };
      throw new Error(`complete_resume_generation: unexpected outcome ${row.outcome}`);
    },
    async fail(userId, requestKey, reason) {
      const svc = await createServiceClient();
      const { error } = await svc.rpc("fail_resume_generation", { p_user_id: userId, p_request_key: requestKey, p_reason: reason });
      if (error) throw new Error(`fail_resume_generation: ${error.message}`);
    },
    async load(userId, resumeId) {
      const svc = await createServiceClient();
      const { data } = await svc
        .from("resumes")
        .select("id, resume_json, regen_of_resume_id")
        .eq("id", resumeId)
        .eq("user_id", userId)
        .maybeSingle();
      return (data as StoredResume | null) ?? null;
    },
  };
}

/** The store the route uses. A function so tests can swap it. */
export function generationStore(): GenerationStore {
  return supabaseGenerationStore();
}
