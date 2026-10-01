// Server-only. The three payment flows, shared by the API routes. Nothing is
// ever granted from the browser's word: a grant happens only in migration
// 016's fulfil_payment_order, after either
//   (a) /api/payments/verify: a valid checkout signature AND Razorpay's own
//       record of the payment (fetched server-side) showing it captured, for
//       this order, for the order's amount in INR; or
//   (b) the webhook: a valid webhook signature over the raw body, for a
//       captured payment — and the database re-checks amount and currency.
// Both paths call the same locked function, so a payment grants exactly once.

import { z } from "zod";
import type { PaymentsConfig } from "@/lib/payments/config";
import { priceFor, SKUS } from "@/lib/payments/catalog";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/payments/signature";
import { createRazorpayOrder, fetchRazorpayPayment } from "@/lib/payments/razorpay";
import type { PaymentStore } from "@/lib/payments/store";

export type ServiceResult = { status: number; body: Record<string, unknown> };
const r = (status: number, body: Record<string, unknown>): ServiceResult => ({ status, body });

export const UNAVAILABLE = r(503, { error: "PAYMENTS_UNAVAILABLE", message: "Payments aren't available yet." });

// ── POST /api/payments/orders ───────────────────────────────────────────────
export const orderInput = z.object({
  sku: z.enum(SKUS),
  with_linkedin_addon: z.boolean().optional().default(false),
  // One checkout attempt. The browser makes a new one per purchase and reuses
  // it only to retry the same purchase, so a double click or retry gets the
  // same order back instead of a second one.
  request_id: z.string().uuid(),
});
// Any other field — notably an amount — is ignored: zod strips unknown keys.

export async function startCheckout(
  config: Extract<PaymentsConfig, { enabled: true }>,
  store: PaymentStore,
  user: { id: string; email: string | null },
  body: unknown
): Promise<ServiceResult> {
  const parsed = orderInput.safeParse(body);
  if (!parsed.success) return r(400, { error: "INVALID_REQUEST", message: parsed.error.issues[0].message });
  const { sku, with_linkedin_addon, request_id } = parsed.data;
  const priced = priceFor(sku, with_linkedin_addon);
  if (!priced) return r(400, { error: "INVALID_PRODUCT", message: "That combination can't be bought." });

  const created = await store.createOrder(user.id, request_id, priced.sku, priced.withLinkedinAddon, config.mode);
  if (created.outcome === "key_reused") return r(409, { error: "REQUEST_ID_REUSED", message: "Please try again." });
  const order = created.order;
  // The database priced it independently (payment_sku_price_paise); they must agree.
  if (order.amountPaise !== priced.amountPaise || order.currency !== "INR") {
    console.error("[payments] catalogue drift: db", order.amountPaise, "app", priced.amountPaise, "sku", sku);
    return r(500, { error: "PRICE_MISMATCH", message: "We couldn't start checkout. Please try again later." });
  }

  let razorpayOrderId = order.razorpayOrderId;
  if (!razorpayOrderId) {
    try {
      const rzp = await createRazorpayOrder(config, {
        amountPaise: order.amountPaise,
        receipt: order.receipt,
        notes: { payment_order_id: order.id, user_id: user.id, sku: order.sku, with_linkedin_addon: String(order.withLinkedinAddon) },
      });
      if (rzp.amount !== order.amountPaise || rzp.currency !== "INR") throw new Error("Razorpay order amount/currency differs from ours");
      razorpayOrderId = await store.attachRazorpayOrder(order.id, rzp.id);
    } catch (err) {
      console.error("[payments] create Razorpay order failed:", err instanceof Error ? err.message : err);
      return r(502, { error: "CHECKOUT_UNAVAILABLE", message: "We couldn't start checkout. You haven't been charged — please try again." });
    }
  }

  return r(200, {
    payment_order_id: order.id,
    razorpay_order_id: razorpayOrderId,
    amount: order.amountPaise,
    currency: order.currency,
    key_id: config.keyId, // public by design; the secret never leaves the server
    description: priced.description,
    prefill: { email: user.email ?? undefined },
  });
}

// ── POST /api/payments/verify ───────────────────────────────────────────────
export const verifyInput = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
});

export async function verifyCheckout(
  config: Extract<PaymentsConfig, { enabled: true }>,
  store: PaymentStore,
  userId: string,
  body: unknown
): Promise<ServiceResult> {
  const parsed = verifyInput.safeParse(body);
  if (!parsed.success) return r(400, { error: "INVALID_REQUEST" });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  // Only the caller's own order. Someone else's (or an unknown) order is 404.
  const order = await store.findOrderForUser(userId, razorpay_order_id);
  if (!order || !order.razorpayOrderId) return r(404, { error: "ORDER_NOT_FOUND" });

  // Signature over OUR stored order id and the payment id, before anything else.
  if (!verifyCheckoutSignature(order.razorpayOrderId, razorpay_payment_id, razorpay_signature, config.keySecret)) {
    return r(400, { error: "SIGNATURE_MISMATCH" });
  }
  if (order.status === "fulfilled" && order.razorpayPaymentId === razorpay_payment_id) {
    return r(200, { status: "fulfilled", already: true });
  }

  // Razorpay's own record decides; the browser's success callback does not.
  let payment;
  try {
    payment = await fetchRazorpayPayment(config, razorpay_payment_id);
  } catch (err) {
    console.error("[payments] fetch payment failed:", err instanceof Error ? err.message : err);
    return r(502, { error: "PAYMENT_LOOKUP_FAILED", message: "We couldn't confirm your payment yet. If you were charged, your purchase will be added automatically." });
  }
  if (payment.id !== razorpay_payment_id || payment.order_id !== order.razorpayOrderId) return r(400, { error: "ORDER_MISMATCH" });
  if (payment.currency !== "INR" || payment.amount !== order.amountPaise) return r(400, { error: "AMOUNT_MISMATCH" });
  if (payment.status === "authorized") {
    return r(202, { status: "pending", message: "Payment received — confirming. Your purchase will be added shortly." });
  }
  if (payment.status !== "captured") return r(402, { error: "PAYMENT_NOT_CAPTURED", status: payment.status });

  const outcome = await store.fulfil(order.razorpayOrderId, payment.id, payment.amount, payment.currency, "verify");
  if (outcome === "fulfilled" || outcome === "already_fulfilled") {
    return r(200, { status: "fulfilled", already: outcome === "already_fulfilled" });
  }
  console.error("[payments] verify could not fulfil:", outcome, order.id);
  return r(409, { error: "NEEDS_REVIEW", outcome, message: "Your payment needs a manual check. Our team will sort it out." });
}

// ── POST /api/payments/razorpay/webhook ─────────────────────────────────────
type Entity = Record<string, unknown>;
const entity = (payload: unknown, key: "payment" | "refund"): Entity | null => {
  const e = (payload as { [k: string]: { entity?: Entity } } | null)?.[key]?.entity;
  return e && typeof e === "object" ? e : null;
};

export async function handleWebhook(
  config: Extract<PaymentsConfig, { enabled: true }>,
  store: PaymentStore,
  rawBody: string,
  signature: string | null,
  eventId: string | null
): Promise<ServiceResult> {
  if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) return r(400, { error: "SIGNATURE_MISMATCH" });
  if (!eventId || eventId.length > 100) return r(400, { error: "MISSING_EVENT_ID" });

  let event: { event?: string; payload?: unknown };
  try { event = JSON.parse(rawBody); } catch { return r(400, { error: "INVALID_JSON" }); }
  const name = typeof event.event === "string" ? event.event : "unknown";
  const payment = entity(event.payload, "payment");
  const refund = entity(event.payload, "refund");
  const rzpOrderId = typeof payment?.order_id === "string" ? payment.order_id : null;

  const seen = await store.recordEvent(eventId, name, rzpOrderId, event);
  if (seen === "duplicate") return r(200, { status: "duplicate" });

  // Throwing from here returns 500 and leaves the event unprocessed, so
  // Razorpay's retry processes it again.
  if ((name === "payment.captured" || name === "order.paid") && payment && rzpOrderId && payment.status === "captured") {
    const outcome = await store.fulfil(rzpOrderId, String(payment.id), Number(payment.amount), String(payment.currency), "webhook");
    if (outcome !== "fulfilled" && outcome !== "already_fulfilled") console.error("[payments] webhook could not fulfil:", outcome, rzpOrderId);
  } else if (name === "payment.failed" && rzpOrderId) {
    await store.recordFailure(rzpOrderId, String(payment?.error_description ?? payment?.error_code ?? "payment failed"));
  } else if (name.startsWith("refund.") && refund) {
    const status = refund.status === "processed" ? "processed" : refund.status === "failed" ? "failed" : "created";
    await store.recordRefund(String(refund.id), String(refund.payment_id), Number(refund.amount), status);
  }
  // Other events are acknowledged and ignored.

  await store.markEventProcessed(eventId);
  return r(200, { status: "processed" });
}
