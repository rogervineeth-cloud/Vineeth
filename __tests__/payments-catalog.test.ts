/**
 * Server pricing: lib/payments/catalog.ts derives every amount from
 * lib/plan-config.ts, and migration 016's payment_sku_price_paise() — which a
 * CHECK on every order row enforces — must agree with it exactly. Plus the
 * HMAC signature helpers.
 */
import * as fs from "fs";
import * as path from "path";
import { createHmac } from "crypto";
import { PLANS, ADDONS } from "@/lib/plan-config";
import { priceFor, SKUS, PACK_SKUS } from "@/lib/payments/catalog";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/payments/signature";

const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "016_payment_orders.sql"), "utf8");
const sqlPrice = (sku: string) => Number(SQL.match(new RegExp(`when '${sku}' then (\\d+)`))![1]);
const sqlBundle = Number(SQL.match(/v := v \+ (\d+);/)![1]);
const sqlCredits = (sku: string) => Number(SQL.match(new RegExp(`payment_sku_credits[\\s\\S]*?when '${sku}' then (\\d+)`))![1]);

describe("server catalogue", () => {
  it("packs are priced from PLANS, in paise, with and without the LinkedIn bundle", () => {
    const li = ADDONS.find((a) => a.id === "linkedin_rewrite")!;
    for (const p of PLANS) {
      expect(priceFor(p.type)!.amountPaise).toBe(p.priceInr * 100);
      expect(priceFor(p.type, true)!.amountPaise).toBe((p.priceInr + li.bundlePriceInr) * 100);
    }
    expect(priceFor("linkedin_rewrite")!.amountPaise).toBe(li.priceInr * 100);
    expect([priceFor("single")!.amountPaise, priceFor("fresher")!.amountPaise, priceFor("job_hunter")!.amountPaise, priceFor("career")!.amountPaise, priceFor("linkedin_rewrite")!.amountPaise])
      .toEqual([9900, 24900, 59900, 99900, 49900]);
  });

  it("invalid combinations have no price", () => {
    expect(priceFor("linkedin_rewrite", true)).toBeNull();
    expect(priceFor("unlimited")).toBeNull();
    expect(priceFor("beta")).toBeNull();
    expect(priceFor("")).toBeNull();
  });

  it("migration 016's SQL price and credit tables match the app exactly", () => {
    for (const sku of SKUS) expect(sqlPrice(sku)).toBe(priceFor(sku)!.amountPaise);
    expect(sqlBundle).toBe(ADDONS.find((a) => a.id === "linkedin_rewrite")!.bundlePriceInr * 100);
    for (const sku of PACK_SKUS) expect(sqlCredits(sku)).toBe(PLANS.find((p) => p.type === sku)!.aiGenerations);
  });
});

describe("signatures (HMAC-SHA256, timing-safe)", () => {
  const sign = (s: string, k: string) => createHmac("sha256", k).update(s).digest("hex");

  it("checkout: order_id|payment_id with the key secret", () => {
    const sig = sign("order_A|pay_B", "secret");
    expect(verifyCheckoutSignature("order_A", "pay_B", sig, "secret")).toBe(true);
    expect(verifyCheckoutSignature("order_A", "pay_B", sig.toUpperCase(), "secret")).toBe(true);
    expect(verifyCheckoutSignature("order_A", "pay_C", sig, "secret")).toBe(false);
    expect(verifyCheckoutSignature("order_X", "pay_B", sig, "secret")).toBe(false);
    expect(verifyCheckoutSignature("order_A", "pay_B", sig, "other")).toBe(false);
    expect(verifyCheckoutSignature("order_A", "pay_B", sig.slice(0, 63), "secret")).toBe(false);
    expect(verifyCheckoutSignature("order_A", "pay_B", "zz" + sig.slice(2), "secret")).toBe(false);
    expect(verifyCheckoutSignature("order_A", "pay_B", "", "secret")).toBe(false);
  });

  it("webhook: the raw body with the webhook secret; any byte change fails", () => {
    const body = '{"event":"payment.captured","payload":{}}';
    const sig = sign(body, "wh");
    expect(verifyWebhookSignature(body, sig, "wh")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "wh")).toBe(false);
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 1), sig, "wh")).toBe(false);
    expect(verifyWebhookSignature(body, null, "wh")).toBe(false);
    expect(verifyWebhookSignature(body, sig, "")).toBe(false);
  });
});
