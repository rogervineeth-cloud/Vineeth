/**
 * Payments are OFF unless strictly configured (lib/payments/config.ts):
 * PAYMENTS_ENABLED=true, a well-formed key id whose mode matches the
 * deployment (live only in VERCEL_ENV=production; test everywhere else), and
 * both secrets present. No secret value ever appears in a reason.
 */
import * as fs from "fs";
import * as path from "path";
import { getPaymentsConfig, isCheckoutAvailable } from "@/lib/payments/config";

const TEST = { PAYMENTS_ENABLED: "true", RAZORPAY_KEY_ID: "rzp_test_AbCdEf123456", RAZORPAY_KEY_SECRET: "s3cr3t-key", RAZORPAY_WEBHOOK_SECRET: "wh-s3cr3t" };
const LIVE = { ...TEST, RAZORPAY_KEY_ID: "rzp_live_AbCdEf123456" };

describe("payments config", () => {
  it("disabled by default (nothing set), and with anything but exactly PAYMENTS_ENABLED=true", () => {
    expect(getPaymentsConfig({})).toEqual({ enabled: false, reason: "not_enabled" });
    for (const v of ["1", "TRUE", "yes", "true ", ""]) expect(getPaymentsConfig({ ...TEST, PAYMENTS_ENABLED: v }).enabled).toBe(false);
    expect(isCheckoutAvailable({})).toBe(false);
  });

  it("preview/development: a test key works only when explicitly enabled", () => {
    for (const VERCEL_ENV of [undefined, "preview", "development"]) {
      expect(getPaymentsConfig({ ...TEST, VERCEL_ENV })).toMatchObject({ enabled: true, mode: "test", keyId: TEST.RAZORPAY_KEY_ID });
    }
  });

  it("a live key is refused outside production", () => {
    for (const VERCEL_ENV of [undefined, "preview", "development"]) {
      expect(getPaymentsConfig({ ...LIVE, VERCEL_ENV })).toEqual({ enabled: false, reason: "live_key_outside_production" });
    }
  });

  it("production: only a live key with both secrets enables checkout; a test key keeps it off", () => {
    expect(getPaymentsConfig({ ...LIVE, VERCEL_ENV: "production" })).toMatchObject({ enabled: true, mode: "live" });
    expect(getPaymentsConfig({ ...TEST, VERCEL_ENV: "production" })).toEqual({ enabled: false, reason: "test_key_in_production" });
    expect(getPaymentsConfig({ ...LIVE, VERCEL_ENV: "production", RAZORPAY_KEY_SECRET: "" })).toEqual({ enabled: false, reason: "missing_key_secret" });
    expect(getPaymentsConfig({ ...LIVE, VERCEL_ENV: "production", RAZORPAY_WEBHOOK_SECRET: undefined })).toEqual({ enabled: false, reason: "missing_webhook_secret" });
    expect(getPaymentsConfig({ PAYMENTS_ENABLED: "true", VERCEL_ENV: "production" })).toEqual({ enabled: false, reason: "missing_key_id" });
  });

  it("malformed key ids are refused", () => {
    for (const id of ["rzp_TEST_abcdefgh", "rzp_test_", "rzp_test_short", "key_live_abcdefgh123", "rzp_live_abc def12345"]) {
      expect(getPaymentsConfig({ ...TEST, RAZORPAY_KEY_ID: id }).enabled).toBe(false);
    }
  });

  it("disabled results never carry secret values", () => {
    const r = getPaymentsConfig({ ...LIVE, VERCEL_ENV: "preview" });
    expect(JSON.stringify(r)).not.toMatch(/s3cr3t/);
  });

  it("only the four approved variable names are read (no NEXT_PUBLIC payment variables)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "lib", "payments", "config.ts"), "utf8");
    const names = [...new Set([...src.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]))].sort();
    expect(names).toEqual(["PAYMENTS_ENABLED", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "VERCEL_ENV"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /NEXT_PUBLIC_(RAZORPAY|PAYMENT)/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    for (const d of ["app", "lib", "components"]) walk(path.join(__dirname, "..", d));
    expect(hits).toEqual([]);
  });
});
