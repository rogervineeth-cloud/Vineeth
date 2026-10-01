/**
 * In-memory PaymentStore for API tests. Mirrors migration 016's functions
 * (which are tested against real PostgreSQL in migration-016-sql.test.ts):
 * server price per SKU, one order per (user, request key), first Razorpay
 * order id wins, fulfilment serialised per order and granting exactly once,
 * amount/currency checks, event de-dupe that retries unprocessed events,
 * refunds recorded without revocation.
 */
import { randomUUID } from "crypto";
import type { PaymentStore, PaymentOrder, FulfilOutcome } from "@/lib/payments/store";

const PRICE: Record<string, number> = { single: 9900, fresher: 24900, job_hunter: 59900, career: 99900, linkedin_rewrite: 49900 };
const CREDITS: Record<string, number> = { single: 1, fresher: 5, job_hunter: 12, career: 25 };

export type FakePaymentStore = PaymentStore & {
  orders: (PaymentOrder & { requestKey: string })[];
  plans: { userId: string; planType: string; credits: number; isTest: boolean; orderId: string; paymentId: string }[];
  addons: { userId: string; isTest: boolean; orderId: string }[];
  events: Map<string, { processed: boolean; attempts: number }>;
  refunds: Map<string, { paymentId: string; amount: number; status: string }>;
  failures: { orderId: string; error: string }[];
  reset(): void;
};

export function createFakePaymentStore(): FakePaymentStore {
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = lock.then(fn);
    lock = next.catch(() => undefined);
    return next;
  };

  const s: FakePaymentStore = {
    orders: [], plans: [], addons: [], events: new Map(), refunds: new Map(), failures: [],
    reset() { s.orders = []; s.plans = []; s.addons = []; s.events = new Map(); s.refunds = new Map(); s.failures = []; },

    async createOrder(userId, requestKey, sku, withAddon, mode) {
      return serial(() => {
        const existing = s.orders.find((o) => o.userId === userId && o.requestKey === requestKey);
        if (existing) {
          if (existing.sku !== sku || existing.withLinkedinAddon !== withAddon || existing.mode !== mode) return { outcome: "key_reused" as const };
          return { outcome: "existing" as const, order: { ...existing } };
        }
        if (sku === "linkedin_rewrite" && withAddon) throw new Error("cannot be bundled");
        const id = randomUUID();
        const order = { id, requestKey, userId, sku, withLinkedinAddon: withAddon, amountPaise: PRICE[sku] + (withAddon ? 39900 : 0),
          currency: "INR", mode, receipt: id, razorpayOrderId: null, razorpayPaymentId: null, status: "created" as const };
        s.orders.push(order);
        return { outcome: "created" as const, order: { ...order } };
      });
    },
    async attachRazorpayOrder(orderId, razorpayOrderId) {
      return serial(() => {
        const o = s.orders.find((x) => x.id === orderId);
        if (!o) throw new Error("unknown order");
        if (!o.razorpayOrderId) o.razorpayOrderId = razorpayOrderId;
        return o.razorpayOrderId;
      });
    },
    async findOrderForUser(userId, razorpayOrderId) {
      const o = s.orders.find((x) => x.razorpayOrderId === razorpayOrderId && x.userId === userId);
      return o ? { ...o } : null;
    },
    async fulfil(razorpayOrderId, paymentId, amountPaise, currency): Promise<FulfilOutcome> {
      return serial(() => {
        const o = s.orders.find((x) => x.razorpayOrderId === razorpayOrderId);
        if (!o) return "unknown_order";
        if (o.razorpayPaymentId) return o.razorpayPaymentId === paymentId ? "already_fulfilled" : "different_payment";
        if (amountPaise !== o.amountPaise) return "amount_mismatch";
        if (currency !== o.currency) return "currency_mismatch";
        if (!o.userId || o.status !== "created") return "needs_review";
        const isTest = o.mode === "test";
        if (CREDITS[o.sku]) s.plans.push({ userId: o.userId, planType: o.sku, credits: CREDITS[o.sku], isTest, orderId: o.id, paymentId });
        if (o.sku === "linkedin_rewrite" || o.withLinkedinAddon) s.addons.push({ userId: o.userId, isTest, orderId: o.id });
        o.razorpayPaymentId = paymentId;
        o.status = "fulfilled";
        return "fulfilled";
      });
    },
    async recordFailure(razorpayOrderId, error) { s.failures.push({ orderId: razorpayOrderId, error }); },
    async recordEvent(eventId) {
      const e = s.events.get(eventId);
      if (!e) { s.events.set(eventId, { processed: false, attempts: 1 }); return "new"; }
      if (e.processed) return "duplicate";
      e.attempts++;
      return "retry";
    },
    async markEventProcessed(eventId) { const e = s.events.get(eventId); if (e) e.processed = true; },
    async recordRefund(refundId, paymentId, amountPaise, status) {
      const o = s.orders.find((x) => x.razorpayPaymentId === paymentId);
      if (!o) return "unknown_payment";
      s.refunds.set(refundId, { paymentId, amount: amountPaise, status });
      return "recorded";
    },
  };
  return s;
}
