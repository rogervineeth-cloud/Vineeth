// What can be bought, and for how much — always computed on the server from
// lib/plan-config.ts (PLANS / ADDONS). The browser sends only a SKU and the
// bundle flag; any amount it sends is ignored. Migration 016's
// payment_sku_price_paise() holds the same table and a CHECK on every order
// row enforces it (kept in step by __tests__/payments-catalog.test.ts).

import { PLANS, ADDONS } from "@/lib/plan-config";

export const PACK_SKUS = ["single", "fresher", "job_hunter", "career"] as const;
export const ADDON_SKU = "linkedin_rewrite" as const;
export const SKUS = [...PACK_SKUS, ADDON_SKU] as const;
export type Sku = (typeof SKUS)[number];
export type PackSku = (typeof PACK_SKUS)[number];

const LINKEDIN = ADDONS.find((a) => a.id === "linkedin_rewrite")!;

export type PricedItem = { sku: Sku; withLinkedinAddon: boolean; amountPaise: number; description: string };

/** Server price, or null for an invalid combination (unknown SKU, add-on bundled with itself). */
export function priceFor(sku: string, withLinkedinAddon = false): PricedItem | null {
  if (sku === ADDON_SKU) {
    if (withLinkedinAddon) return null;
    return { sku, withLinkedinAddon: false, amountPaise: LINKEDIN.priceInr * 100, description: LINKEDIN.name };
  }
  const plan = PLANS.find((p) => p.type === sku);
  if (!plan) return null;
  const inr = plan.priceInr + (withLinkedinAddon ? LINKEDIN.bundlePriceInr : 0);
  return {
    sku: plan.type as PackSku,
    withLinkedinAddon,
    amountPaise: inr * 100,
    description: `${plan.name} — ${plan.aiGenerations} AI-tailored resume${plan.aiGenerations !== 1 ? "s" : ""}${withLinkedinAddon ? " + LinkedIn Rewrite" : ""}`,
  };
}
