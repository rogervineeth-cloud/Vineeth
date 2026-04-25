// Server-only — uses cookies(), do not import in client components
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { PlanType } from "@/lib/plan-config";
import { PLAN_ALLOTMENTS } from "@/lib/plan-config";

export type ActivePlan = {
  id: string;
  user_id: string;
  plan_type: PlanType;
  resumes_allotted: number;
  resumes_used: number;
  expires_at: string;
  purchased_at: string;
  is_test: boolean;
};

/** Most recent non-expired plan that still has credits, or null. */
export async function getUserActivePlan(userId: string): Promise<ActivePlan | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_plans")
    .select("*")
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("purchased_at", { ascending: false });

  if (!data?.length) return null;
  return (data.find((p) => p.resumes_used < p.resumes_allotted) as ActivePlan) ?? null;
}

/** Whether this user may generate a new resume. */
export async function canGenerateResume(
  userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_plans")
    .select("id, resumes_used, resumes_allotted, expires_at")
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString());

  if (!data?.length) return { allowed: false, reason: "NO_PLAN" };
  const active = data.find((p) => p.resumes_used < p.resumes_allotted);
  if (!active) return { allowed: false, reason: "CREDITS_EXHAUSTED" };
  return { allowed: true };
}

/**
 * True when the user is regenerating the SAME resume within 24 hours.
 * In that case no credit is consumed.
 */
export async function canGenerateFreeRegen(
  userId: string,
  originalResumeId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data: resume } = await supabase
    .from("resumes")
    .select("created_at")
    .eq("id", originalResumeId)
    .eq("user_id", userId)
    .single();

  if (!resume) return false;
  const ageMs = Date.now() - new Date(resume.created_at).getTime();
  return ageMs < 24 * 60 * 60 * 1000;
}

/**
 * Atomically increment resumes_used on the active plan.
 * Uses optimistic locking — returns false on a race condition (caller may retry).
 */
export async function consumeCredit(userId: string): Promise<boolean> {
  const plan = await getUserActivePlan(userId);
  if (!plan) return false;

  const svc = await createServiceClient();
  const { data } = await svc
    .from("user_plans")
    .update({ resumes_used: plan.resumes_used + 1 })
    .eq("id", plan.id)
    .eq("user_id", userId)
    .eq("resumes_used", plan.resumes_used) // optimistic lock
    .select("id");

  return (data?.length ?? 0) > 0;
}

/**
 * Decrement resumes_used — called when generation fails after a credit was consumed.
 * Fetches the most recent non-expired plan regardless of credit balance.
 */
export async function refundCredit(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("user_plans")
    .select("id, resumes_used")
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .order("purchased_at", { ascending: false })
    .limit(1);

  const plan = plans?.[0];
  if (!plan || plan.resumes_used === 0) return false;

  const svc = await createServiceClient();
  const { data } = await svc
    .from("user_plans")
    .update({ resumes_used: plan.resumes_used - 1 })
    .eq("id", plan.id)
    .eq("user_id", userId)
    .eq("resumes_used", plan.resumes_used)
    .select("id");

  return (data?.length ?? 0) > 0;
}

/** Whether the user may download a specific resume PDF. */
export async function canDownloadResume(userId: string, resumeId: string): Promise<boolean> {
  // Any active plan → always allowed
  const plan = await getUserActivePlan(userId);
  if (plan) return true;

  // Already downloaded once → re-downloads are always free
  const supabase = await createClient();
  const { data: resume } = await supabase
    .from("resumes")
    .select("downloaded_at")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .single();

  return !!(resume?.downloaded_at);
}

/** Insert a test plan row via the service role (bypasses RLS). */
export async function grantTestPlan(userId: string, planType: PlanType): Promise<ActivePlan> {
  const allotted = PLAN_ALLOTMENTS[planType];
  const svc = await createServiceClient();
  const { data, error } = await svc
    .from("user_plans")
    .insert({
      user_id: userId,
      plan_type: planType,
      resumes_allotted: allotted,
      resumes_used: 0,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      is_test: true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ActivePlan;
}
