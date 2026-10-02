// Client-safe. The signed-in account's plans as the create page and the
// dashboard show them, making sure the Free Beta credits have been granted
// first (migration 015; POST /api/beta/claim, idempotent server-side).

export type PlanRow = {
  id?: string;
  plan_type: string;
  resumes_allotted: number;
  resumes_used: number | null;
  expires_at: string;
  purchased_at?: string | null;
};

export type PlanSummary =
  /** A plan with a credit left: the one the next generation will be charged to. */
  | { state: "active"; plan: PlanRow; remaining: number }
  /** Every plan used up (or expired) — e.g. the 3 beta generations are spent. */
  | { state: "exhausted"; allotted: number }
  /** No plan at all: the beta grant could not be made (shown as an error, not a paywall). */
  | { state: "none" };

/** Newest purchase first, like the server's charge order (migration 013). */
export function summarisePlans(plans: readonly PlanRow[], now: Date = new Date()): PlanSummary {
  const live = plans
    .filter((p) => Date.parse(p.expires_at) > now.getTime())
    .sort((a, b) => Date.parse(b.purchased_at ?? "") - Date.parse(a.purchased_at ?? ""));
  const active = live.find((p) => (p.resumes_used ?? 0) < p.resumes_allotted);
  if (active) return { state: "active", plan: active, remaining: active.resumes_allotted - (active.resumes_used ?? 0) };
  if (plans.length > 0) return { state: "exhausted", allotted: (plans.find((p) => p.plan_type === "beta") ?? plans[0]).resumes_allotted };
  return { state: "none" };
}

type PlansQuery = {
  from(table: string): unknown;
};
type Select = { select(c: string): { eq(c: string, v: string): PromiseLike<{ data: PlanRow[] | null; error: { message: string } | null }> } };

/**
 * All of this account's plans. If there is no beta plan yet, claims it once
 * and reads again — so a new account sees its 1 free AI resume preview before
 * its first generation. Throws on a failed read (callers show a load error).
 */
export async function loadPlansEnsuringBeta(
  supabase: PlansQuery,
  userId: string,
  claim: () => Promise<unknown> = () => fetch("/api/beta/claim", { method: "POST" })
): Promise<PlanRow[]> {
  const read = async () => {
    const { data, error } = await (supabase.from("user_plans") as Select)
      .select("id,plan_type,resumes_allotted,resumes_used,expires_at,purchased_at")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const plans = await read();
  if (plans.some((p) => p.plan_type === "beta")) return plans;
  try { await claim(); } catch { /* the read below shows whatever exists */ }
  return read();
}
