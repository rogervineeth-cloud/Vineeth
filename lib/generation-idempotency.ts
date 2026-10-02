// Server-only. Idempotent resume generation with credits reserved BEFORE the
// model call — supabase/migrations/018_free_preview_entitlement.sql (built on
// 013's attempt table).
//
// The route calls begin() before the model (locks the attempt and, when
// charging, reserves one credit — paid first, then the single free preview
// credit; none left -> payment_required, no model call), then complete()
// (save the resume; a download entitlement only if a PAID credit was used)
// or fail() (release the lock and the reserved credit). The store is an
// interface so route tests can run the same flow against an in-memory double;
// the real one calls the migration's _v2 RPCs with the service client.

import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { normaliseJd } from "@/lib/regen";

/** How long an attempt holds its lock if the server dies mid-request. The route's maxDuration is 60 s. */
export const GENERATION_LEASE_SECONDS = 150;

export type BeginOutcome =
  /** planType: the plan whose credit was reserved ("beta" = the free preview); null when not charging. */
  | { outcome: "started"; planType: string | null }
  | { outcome: "replay"; resumeId: string }
  | { outcome: "in_progress" }
  | { outcome: "key_reused" }
  | { outcome: "payment_required" };

export type CompleteOutcome =
  /** entitled: whether the resume may be downloaded (a paid credit, or the creator account). */
  | { outcome: "completed"; resumeId: string; entitled: boolean }
  | { outcome: "replay"; resumeId: string; entitled: boolean }
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

export type StoredResume = { id: string; resume_json: unknown; regen_of_resume_id: string | null; entitled: boolean };

export interface GenerationStore {
  /** charge=false only for the creator account. */
  begin(userId: string, requestKey: string, fingerprint: string, charge: boolean): Promise<BeginOutcome>;
  complete(userId: string, requestKey: string, row: GeneratedResumeRow, isCreator: boolean): Promise<CompleteOutcome>;
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

type RpcRow = { outcome: string; resume_id: string | null; plan_type?: string | null; entitled?: boolean | null };

function firstRow(data: unknown): RpcRow {
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined;
  if (!row || typeof row.outcome !== "string") throw new Error("generation store: empty RPC result");
  return row;
}

/** The real store: migration 013's RPCs, called as service_role. */
export function supabaseGenerationStore(): GenerationStore {
  return {
    async begin(userId, requestKey, fingerprint, charge) {
      const svc = await createServiceClient();
      const { data, error } = await svc.rpc("begin_resume_generation_v2", {
        p_user_id: userId, p_request_key: requestKey, p_fingerprint: fingerprint, p_lease_seconds: GENERATION_LEASE_SECONDS, p_charge: charge,
      });
      if (error) throw new Error(`begin_resume_generation_v2: ${error.message}`);
      const row = firstRow(data);
      if (row.outcome === "started") return { outcome: "started", planType: row.plan_type ?? null };
      if (row.outcome === "replay" && row.resume_id) return { outcome: "replay", resumeId: row.resume_id };
      if (row.outcome === "in_progress" || row.outcome === "key_reused" || row.outcome === "payment_required") return { outcome: row.outcome };
      throw new Error(`begin_resume_generation_v2: unexpected outcome ${row.outcome}`);
    },
    async complete(userId, requestKey, resumeRow, isCreator) {
      const svc = await createServiceClient();
      const { data, error } = await svc.rpc("complete_resume_generation_v2", {
        p_user_id: userId, p_request_key: requestKey, p_resume: resumeRow, p_is_creator: isCreator,
      });
      if (error) throw new Error(`complete_resume_generation_v2: ${error.message}`);
      const row = firstRow(data);
      if ((row.outcome === "completed" || row.outcome === "replay") && row.resume_id) return { outcome: row.outcome, resumeId: row.resume_id, entitled: !!row.entitled };
      if (row.outcome === "expired" || row.outcome === "unknown_request") return { outcome: row.outcome };
      throw new Error(`complete_resume_generation_v2: unexpected outcome ${row.outcome}`);
    },
    async fail(userId, requestKey, reason) {
      const svc = await createServiceClient();
      const { error } = await svc.rpc("fail_resume_generation_v2", { p_user_id: userId, p_request_key: requestKey, p_reason: reason });
      if (error) throw new Error(`fail_resume_generation_v2: ${error.message}`);
    },
    async load(userId, resumeId) {
      const svc = await createServiceClient();
      const { data } = await svc
        .from("resumes")
        .select("id, resume_json, regen_of_resume_id")
        .eq("id", resumeId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return null;
      const { data: ent } = await svc.from("resume_entitlements").select("resume_id").eq("resume_id", resumeId).maybeSingle();
      return { ...(data as Omit<StoredResume, "entitled">), entitled: !!ent };
    },
  };
}

/** The store the route uses. A function so tests can swap it. */
export function generationStore(): GenerationStore {
  return supabaseGenerationStore();
}
