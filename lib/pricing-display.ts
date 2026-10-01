// Client-safe. The paid pricing scheme as it is displayed on the landing page
// and /pricing — restored exactly as it was before commit 7709d56 (Free Beta)
// hid it. The tiers come from PLANS / ADDONS (lib/plan-config.ts, unchanged
// since then); the card text is the same as it was.
//
// PAYMENTS ARE NOT LIVE. Razorpay is not integrated: every purchase control
// renders disabled as "Payments coming soon", makes no request, and creates
// no order or entitlement. The Free Beta (3 generations per account,
// migration 015) is the offer that is available now, shown separately.

import { PLANS, ADDONS, type Plan } from "@/lib/plan-config";

export const PAYMENTS_LIVE = false;
export const PAYMENTS_COMING_SOON = "Payments coming soon";

/** Feature bullets of a paid plan card (as on /pricing and the landing page before 7709d56). */
export function planFeatures(plan: Plan): string[] {
  const n = plan.aiGenerations;
  return [
    `${n} AI-tailored resume${n !== 1 ? "s" : ""}`,
    "Unlimited PDF downloads",
    "Live ATS keyword score",
    "1-year validity",
  ];
}

export type PaidTierCard = {
  slug: Plan["type"];
  name: string;
  price: string;
  resumes: string;
  popular: boolean;
  features: string[];
};

/** The landing page's four paid cards, in PLANS order. */
export const PAID_TIERS: readonly PaidTierCard[] = PLANS.map((p) => ({
  slug: p.type,
  name: p.name,
  price: `₹${p.priceInr}`,
  resumes: `${p.aiGenerations} AI-tailored resume${p.aiGenerations !== 1 ? "s" : ""}`,
  popular: p.badge === "Most popular",
  features: planFeatures(p),
}));

export const LINKEDIN_ADDON = ADDONS.find((a) => a.id === "linkedin_rewrite")!;
