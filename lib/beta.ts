// Server-only. The free AI resume preview: every VERIFIED account gets ONE
// free generation credit, once (migrations 015 + 018); callers check the
// email is confirmed. Resumes made with it cannot be downloaded. The grant is a server-only SQL function that inserts one
// 'beta' user_plans row per account at most — idempotent and race-safe — so
// calling it on every page load or generation is fine.

import { createServiceClient } from "@/lib/supabase/server";

export type BetaGrant = "granted" | "existing" | "unavailable";

/**
 * Makes sure this account has had its Free Beta credits. Never throws: if the
 * grant cannot be made (e.g. migration 015 not applied yet), it logs and
 * returns "unavailable", and the caller carries on exactly as before — a user
 * without a plan still gets 402, nobody gets unlimited generations.
 */
export async function ensureBetaCredits(userId: string): Promise<BetaGrant> {
  try {
    const svc = await createServiceClient();
    const { data, error } = await svc.rpc("grant_beta_credits", { p_user_id: userId });
    if (error) throw new Error(error.message);
    return data === true ? "granted" : "existing";
  } catch (err) {
    console.error("[beta] grant_beta_credits failed:", err instanceof Error ? err.message : err);
    return "unavailable";
  }
}
