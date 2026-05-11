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
        price: "₹99",
        perDownload: "₹99 / download",
        resumes: 1,
        popular: false,
        features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
        type: "fresher" as PlanType,
        name: "Fresher",
        price: "₹249",
        perDownload: "₹49.80 / download · save 50%",
        resumes: 5,
        popular: true,
        features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
        type: "job_hunter" as PlanType,
        name: "Job Hunter",
        price: "₹599",
        perDownload: "₹49.92 / download · save 50%",
        resumes: 12,
        popular: false,
        features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
        type: "placement_pro" as PlanType,
        name: "Placement Pro",
        price: "₹999",
        perDownload: "₹39.96 / download · save 60%",
        resumes: 25,
        popular: false,
        features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity", "Priority support"],
  },
  ] as const;

export const ADDONS = [
  {
        id: "linkedin_rewrite",
        name: "LinkedIn Profile Rewrite",
        price: "₹500",
        description: "Recruiter-ready LinkedIn headline, About, and Experience rewrite — keyword-optimised for your target role.",
        features: ["Headline rewrite", "About section rewrite", "Experience bullets", "Keyword-optimised"],
  },
  ] as const;
