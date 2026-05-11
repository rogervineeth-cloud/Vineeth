// Shared plan constants — safe to import from client and server components.
//
// SKUs:
//   free         — implicit default. NOT materialized as a user_plans row.
//                  Used for the deterministic ATS review only.
//   single       — 1 download
//   fresher      — 5 downloads (Most popular)
//   job_hunter   — 12 downloads
//   career       — 25 downloads (Best value)
export type PlanType = "free" | "single" | "fresher" | "job_hunter" | "career";

export const PLAN_LABELS: Record<PlanType, string> = {
  free: "Free",
  single: "Single",
  fresher: "Fresher",
  job_hunter: "Job Hunter",
  career: "Career Pack",
};

export const PLAN_ALLOTMENTS: Record<PlanType, number> = {
  free: 0,
  single: 1,
  fresher: 5,
  job_hunter: 12,
  career: 25,
};

export type Plan = {
  type: Exclude<PlanType, "free">;
  name: string;
  priceInr: number;
  downloads: number;
  badge: "Most popular" | "Best value" | null;
};

export const PLANS: readonly Plan[] = [
  { type: "single",     name: "Single",      priceInr: 99,  downloads: 1,  badge: null },
  { type: "fresher",    name: "Fresher",     priceInr: 269, downloads: 5,  badge: "Most popular" },
  { type: "job_hunter", name: "Job Hunter",  priceInr: 599, downloads: 12, badge: null },
  { type: "career",     name: "Career Pack", priceInr: 999, downloads: 25, badge: "Best value" },
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
