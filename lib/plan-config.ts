// Shared plan constants — safe to import from client and server components

export type PlanType = "starter" | "fresher" | "job_hunter" | "placement_pro";

export const PLAN_LABELS: Record<PlanType, string> = {
  starter: "Starter",
  fresher: "Fresher",
  job_hunter: "Job Hunter",
  placement_pro: "Placement Pro",
};

export const PLAN_ALLOTMENTS: Record<PlanType, number> = {
  starter: 1,
  fresher: 5,
  job_hunter: 12,
  placement_pro: 25,
};

export const PLANS = [
  {
    type: "starter" as PlanType,
    name: "Starter",
    price: "₹100",
    resumes: 1,
    popular: false,
    features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
    type: "fresher" as PlanType,
    name: "Fresher",
    price: "₹299",
    resumes: 5,
    popular: true,
    features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
    type: "job_hunter" as PlanType,
    name: "Job Hunter",
    price: "₹599",
    resumes: 12,
    popular: false,
    features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
] as const;
