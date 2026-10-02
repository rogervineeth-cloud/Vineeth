// Whether a resume's PDF may be downloaded, and what to offer when it may
// not. Safe to import from client and server components.
//
// RULE (migration 018): a PDF can be downloaded only for a resume covered by
// a PAID credit — a row in resume_entitlements, written server-side when a
// resume is generated with a paid credit, when a paid credit is spent to
// unlock it (POST /api/resumes/[id]/unlock, once per resume), for the creator
// account, or by the migration's backfill for resumes made under a paid plan.
// The free AI resume preview never has one.
//
// Removed (they let free resumes be downloaded): "downloaded once before →
// free re-downloads", "any active plan → any resume", and "a plan was held
// when the resume was created".
//
// Invariant: an entitled resume can be re-downloaded any number of times
// without another charge; a download request never spends a credit by itself
// (only the explicit unlock does, and only once).

export type DownloadAction =
  /** Covered by a paid credit: download freely. */
  | "download"
  /** Not covered, but the user has a paid credit: offer "Use 1 credit to download". */
  | "unlock"
  /** Not covered and no paid credit: point to pricing. */
  | "upgrade";

export function downloadAction(entitled: boolean, paidCreditsLeft: number): DownloadAction {
  if (entitled) return "download";
  return paidCreditsLeft > 0 ? "unlock" : "upgrade";
}

export type CreditPlan = {
  plan_type: string;
  resumes_allotted: number;
  resumes_used: number | null;
  expires_at: string;
};

/** Unexpired PAID credits left (the free preview credit never unlocks a download). */
export function paidCreditsLeft(plans: readonly CreditPlan[], now: Date = new Date()): number {
  return plans
    .filter((p) => p.plan_type !== "beta" && Date.parse(p.expires_at) > now.getTime())
    .reduce((n, p) => n + Math.max(0, p.resumes_allotted - (p.resumes_used ?? 0)), 0);
}

/** The free preview credit still unused (0 or 1). */
export function freeCreditsLeft(plans: readonly CreditPlan[], now: Date = new Date()): number {
  return plans
    .filter((p) => p.plan_type === "beta" && Date.parse(p.expires_at) > now.getTime())
    .reduce((n, p) => n + Math.max(0, p.resumes_allotted - (p.resumes_used ?? 0)), 0);
}
