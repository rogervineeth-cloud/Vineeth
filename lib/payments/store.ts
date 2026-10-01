// Server-only. Payment persistence: migration 016's functions, called with
// the service client. An interface so API tests can run the same flows
// against an in-memory double (the SQL itself is tested on real PostgreSQL
// in migration-016-sql.test.ts).

import { createServiceClient } from "@/lib/supabase/server";
import type { Sku } from "@/lib/payments/catalog";
import type { PaymentsMode } from "@/lib/payments/config";

export type PaymentOrder = {
  id: string;
  userId: string | null;
  sku: Sku;
  withLinkedinAddon: boolean;
  amountPaise: number;
  currency: string;
  mode: PaymentsMode;
  receipt: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  status: "created" | "fulfilled" | "refunded" | "partially_refunded" | "needs_review";
};

export type CreateOrderResult =
  | { outcome: "created" | "existing"; order: PaymentOrder }
  | { outcome: "key_reused" };

export type FulfilOutcome =
  | "fulfilled" | "already_fulfilled" | "unknown_order" | "amount_mismatch"
  | "currency_mismatch" | "different_payment" | "needs_review";

export type EventRecord = "new" | "retry" | "duplicate";

export interface PaymentStore {
  createOrder(userId: string, requestKey: string, sku: Sku, withAddon: boolean, mode: PaymentsMode): Promise<CreateOrderResult>;
  attachRazorpayOrder(orderId: string, razorpayOrderId: string): Promise<string>;
  /** The order with this Razorpay order id, only if it belongs to userId. */
  findOrderForUser(userId: string, razorpayOrderId: string): Promise<PaymentOrder | null>;
  fulfil(razorpayOrderId: string, razorpayPaymentId: string, amountPaise: number, currency: string, source: "verify" | "webhook"): Promise<FulfilOutcome>;
  recordFailure(razorpayOrderId: string, error: string): Promise<void>;
  recordEvent(eventId: string, event: string, razorpayOrderId: string | null, payload: unknown): Promise<EventRecord>;
  markEventProcessed(eventId: string): Promise<void>;
  recordRefund(refundId: string, paymentId: string, amountPaise: number, status: "created" | "processed" | "failed"): Promise<"recorded" | "unknown_payment">;
}

type Row = Record<string, unknown>;
const toOrder = (r: Row): PaymentOrder => ({
  id: r.id as string, userId: (r.user_id as string) ?? null, sku: r.sku as Sku,
  withLinkedinAddon: !!r.with_linkedin_addon, amountPaise: Number(r.amount_paise), currency: r.currency as string,
  mode: r.mode as PaymentsMode, receipt: r.receipt as string, razorpayOrderId: (r.razorpay_order_id as string) ?? null,
  razorpayPaymentId: (r.razorpay_payment_id as string) ?? null, status: r.status as PaymentOrder["status"],
});

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const svc = await createServiceClient();
  const { data, error } = await svc.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
const first = (data: unknown): Row => {
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) throw new Error("payment store: empty RPC result");
  return row;
};

export function supabasePaymentStore(): PaymentStore {
  const store: PaymentStore = {
    async createOrder(userId, requestKey, sku, withAddon, mode) {
      const row = first(await rpc("create_payment_order", { p_user_id: userId, p_client_request_key: requestKey, p_sku: sku, p_with_addon: withAddon, p_mode: mode }));
      if (row.outcome === "key_reused") return { outcome: "key_reused" };
      const svc = await createServiceClient();
      const { data, error } = await svc.from("payment_orders").select("*").eq("id", row.payment_order_id as string).single();
      if (error || !data) throw new Error(`payment_orders read: ${error?.message ?? "missing"}`);
      return { outcome: row.outcome as "created" | "existing", order: toOrder(data as Row) };
    },
    async attachRazorpayOrder(orderId, razorpayOrderId) {
      return rpc<string>("attach_razorpay_order", { p_payment_order_id: orderId, p_razorpay_order_id: razorpayOrderId });
    },
    async findOrderForUser(userId, razorpayOrderId) {
      const svc = await createServiceClient();
      const { data } = await svc.from("payment_orders").select("*").eq("razorpay_order_id", razorpayOrderId).eq("user_id", userId).maybeSingle();
      return data ? toOrder(data as Row) : null;
    },
    async fulfil(razorpayOrderId, razorpayPaymentId, amountPaise, currency, source) {
      const row = first(await rpc("fulfil_payment_order", { p_razorpay_order_id: razorpayOrderId, p_razorpay_payment_id: razorpayPaymentId, p_amount_paise: amountPaise, p_currency: currency, p_source: source }));
      return row.outcome as FulfilOutcome;
    },
    async recordFailure(razorpayOrderId, error) {
      await rpc("record_payment_failure", { p_razorpay_order_id: razorpayOrderId, p_error: error });
    },
    async recordEvent(eventId, event, razorpayOrderId, payload) {
      return rpc<EventRecord>("record_payment_event", { p_razorpay_event_id: eventId, p_event: event, p_razorpay_order_id: razorpayOrderId, p_payload: payload });
    },
    async markEventProcessed(eventId) {
      await rpc("mark_payment_event_processed", { p_razorpay_event_id: eventId });
    },
    async recordRefund(refundId, paymentId, amountPaise, status) {
      return rpc<"recorded" | "unknown_payment">("record_payment_refund", { p_razorpay_refund_id: refundId, p_razorpay_payment_id: paymentId, p_amount_paise: amountPaise, p_status: status });
    },
  };
  return store;
}

/** The store the API routes use. A function so tests can swap it. */
export function paymentStore(): PaymentStore {
  return supabasePaymentStore();
}
