// Razorpay signatures (HMAC-SHA256, hex), compared in constant time.
import { createHmac, timingSafeEqual } from "crypto";

function safeEqualHex(expectedHex: string, given: string): boolean {
  if (typeof given !== "string" || !/^[0-9a-f]+$/i.test(given)) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(given.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout success callback: HMAC(order_id + "|" + payment_id, key secret). */
export function verifyCheckoutSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string, keySecret: string): boolean {
  if (!razorpayOrderId || !razorpayPaymentId || !keySecret) return false;
  const expected = createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhook: HMAC(raw request body, webhook secret) vs X-Razorpay-Signature. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
  return safeEqualHex(expected, signature);
}
