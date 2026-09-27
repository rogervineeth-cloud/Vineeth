// Shared plan constants — safe to import from client and server components.
//
// SKUs:
//   free         — 1 free ATS preview per signed-up account. NOT materialized
//                  as a user_plans row; usage is tracked on profiles.
//                  free_review_used_at.
//   single       — 1 AI-tailored resume
//   fresher      — 5 AI-tailored resumes (Most popular)
//   job_hunter   — 12 AI-tailored resumes
//   career       — 25 AI-tailored resumes (Best value)
//
//   beta         — FREE BETA (until payments launch): 3 AI-tailored resumes
//                  per account, granted once by the server (migration 015,
//                  lib/beta.ts). The paid SKUs below are kept for later but not
//                  offered anywhere in the UI while FREE_BETA is on.
//
// Each AI-tailored resume can be re-downloaded as a PDF unlimited times.
export type PlanType = "free" | "beta" | "single" | "fresher" | "job_hunter" | "career";

export const PLAN_LABELS: Record<PlanType, string> = {
  free: "Free",
  beta: "Free Beta",
  single: "Single",
  fresher: "Fresher",
  job_hunter: "Job Hunter",
  career: "Career Pack",
};

export const PLAN_ALLOTMENTS: Record<PlanType, number> = {
  free: 0,
  beta: 3,
  single: 1,
  fresher: 5,
  job_hunter: 12,
  career: 25,
};

export type Plan = {
  type: Exclude<PlanType, "free">;
  name: string;
  priceInr: number;
  aiGenerations: number;
  badge: "Most popular" | "Best value" | null;
};

export const PLANS: readonly Plan[] = [
  { type: "single",     name: "Single",      priceInr: 99,  aiGenerations: 1,  badge: null },
  { type: "fresher",    name: "Fresher",     priceInr: 249, aiGenerations: 5,  badge: "Most popular" },
  { type: "job_hunter", name: "Job Hunter",  priceInr: 599, aiGenerations: 12, badge: null },
  { type: "career",     name: "Career Pack", priceInr: 999, aiGenerations: 25, badge: "Best value" },
];

export type Addon = {
  id: "linkedin_rewrite";
  name: string;
  priceInr: number;       // standalone price
  bundlePriceInr: number; // price when added to any paid plan
};

export const ADDONS: readonly Addon[] = [
  {
    id: "linkedin_rewrite",
    name: "LinkedIn Profile Rewrite",
    priceInr: 499,
    bundlePriceInr: 399,
  },
];

/**
 * Free Beta: paid plans and checkout are hidden everywhere until payments
 * (Razorpay) are integrated. Every account gets BETA_CREDITS generations once.
 */
export const FREE_BETA = true;
export const BETA_CREDITS = 3;
export const FREE_BETA_LABEL = "Free Beta · 3 resume generations";
/** Shown when an account has used its beta credits. No purchase is offered. */
export const BETA_EXHAUSTED_MESSAGE =
  "You've used your 3 free beta resume generations. Paid plans aren't available yet — we'll let you know when they are.";
