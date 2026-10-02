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
//   beta         — the FREE AI RESUME PREVIEW: exactly 1 AI-tailored resume
//                  per verified account, granted once by the server
//                  (migrations 015 + 018, lib/beta.ts). It can be viewed but
//                  NOT downloaded as a PDF.
//
// PDF downloads need a PAID credit: a resume generated with a paid credit can
// be re-downloaded any number of times; a free preview needs one paid credit
// spent on it, once (migration 018 unlock_resume_download).
export type PlanType = "free" | "beta" | "single" | "fresher" | "job_hunter" | "career";

export const PLAN_LABELS: Record<PlanType, string> = {
  free: "Free",
  beta: "Free preview",
  single: "Single",
  fresher: "Fresher",
  job_hunter: "Job Hunter",
  career: "Career Pack",
};

export const PLAN_ALLOTMENTS: Record<PlanType, number> = {
  free: 0,
  beta: 1,
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
 * The free offer (migration 018): ONE free AI resume preview per verified
 * account. It can be viewed; a PDF download requires a paid credit. Every
 * later generation (including regenerations) requires a paid credit.
 */
export const FREE_BETA = true;
export const BETA_CREDITS = 1;
//
// Customer-facing copy must say exactly this (tests: __tests__/credit-copy.test.ts):
//   * the first AI resume of a verified account is a free, VIEW-ONLY preview;
//   * every later Generate and every Regenerate costs 1 paid credit (its PDF included);
//   * spending 1 paid credit unlocks the free preview's PDF (once);
//   * resumes generated with paid credits can be downloaded again at no extra credit.
// Never "every PDF download needs a credit", never a free regeneration.
export const FREE_PREVIEW_RULE =
  "Your first AI resume is a free, view-only preview. Every later Generate or Regenerate costs 1 paid credit, PDF included; 1 paid credit also unlocks the free preview's PDF.";
export const FREE_BETA_LABEL = "First AI resume free (view-only) · then 1 paid credit per resume";
/** 402 from /api/generate-resume and the create page once the free preview is used. */
export const FREE_PREVIEW_USED_MESSAGE =
  "You've used your free, view-only AI resume preview. Each new Generate or Regenerate costs 1 paid credit, PDF included.";
export const VERIFY_EMAIL_FOR_FREE_MESSAGE =
  "Verify your email address to get your free, view-only AI resume preview.";
/** Shown when an account has no credit left. */
export const BETA_EXHAUSTED_MESSAGE = FREE_PREVIEW_USED_MESSAGE;
/** A free preview resume, where a download would be. */
export const FREE_PREVIEW_DOWNLOAD_MESSAGE =
  "This is your free, view-only AI resume preview. Spend 1 paid credit to unlock its PDF — once; downloading again is free.";
