// Server-only. Whether Razorpay checkout may run, decided from exactly four
// variables: PAYMENTS_ENABLED, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
// RAZORPAY_WEBHOOK_SECRET (plus VERCEL_ENV, set by Vercel itself).
//
// OFF BY DEFAULT. Checkout is available only when ALL of these hold:
//   * PAYMENTS_ENABLED is exactly "true";
//   * RAZORPAY_KEY_ID is a well-formed rzp_test_… or rzp_live_… key id;
//   * RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are set;
//   * the key mode matches the deployment:
//       VERCEL_ENV=production  → rzp_live_ only (a test key keeps checkout off),
//       anything else          → rzp_test_ only (a live key is refused).
// Anything else → { enabled: false, reason } and every payment endpoint and
// buy button stays unavailable. Reasons never include secret values.

export type PaymentsMode = "test" | "live";

export type PaymentsConfig =
  | { enabled: true; mode: PaymentsMode; keyId: string; keySecret: string; webhookSecret: string }
  | { enabled: false; reason: PaymentsDisabledReason };

export type PaymentsDisabledReason =
  | "not_enabled"
  | "missing_key_id"
  | "malformed_key_id"
  | "missing_key_secret"
  | "missing_webhook_secret"
  | "live_key_outside_production"
  | "test_key_in_production";

type Env = Record<string, string | undefined>;

const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,}$/;

export function getPaymentsConfig(env: Env = process.env): PaymentsConfig {
  if (env.PAYMENTS_ENABLED !== "true") return { enabled: false, reason: "not_enabled" };
  const keyId = (env.RAZORPAY_KEY_ID ?? "").trim();
  if (!keyId) return { enabled: false, reason: "missing_key_id" };
  const m = keyId.match(KEY_ID);
  if (!m) return { enabled: false, reason: "malformed_key_id" };
  const mode: PaymentsMode = m[1] === "live" ? "live" : "test";
  const production = env.VERCEL_ENV === "production";
  if (mode === "live" && !production) return { enabled: false, reason: "live_key_outside_production" };
  if (mode === "test" && production) return { enabled: false, reason: "test_key_in_production" };
  const keySecret = env.RAZORPAY_KEY_SECRET ?? "";
  if (!keySecret) return { enabled: false, reason: "missing_key_secret" };
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) return { enabled: false, reason: "missing_webhook_secret" };
  return { enabled: true, mode, keyId, keySecret, webhookSecret };
}

/** For server components deciding whether to render buy buttons. */
export function isCheckoutAvailable(env: Env = process.env): boolean {
  return getPaymentsConfig(env).enabled;
}
