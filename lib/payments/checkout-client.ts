// Client-safe. The Razorpay Standard Checkout handoff, as a plain function
// with injected dependencies (testable without a browser):
//   1. ask OUR server for an order (it prices the SKU; we send no amount);
//   2. only then load Razorpay's checkout.js and open it for that order;
//   3. on Razorpay's success callback, ask OUR server to verify — the server
//      decides; this code never grants anything;
//   4. report honest states: a closed modal is "not completed", a failed
//      payment shows Razorpay's reason, an unconfirmed payment says it will be
//      added once confirmed (the webhook fulfils it independently).

export type CheckoutItem = { sku: string; withLinkedinAddon?: boolean };

export type CheckoutState =
  | { kind: "starting" }
  | { kind: "open" }
  | { kind: "verifying" }
  | { kind: "success" }
  | { kind: "pending"; message: string }
  | { kind: "cancelled"; message: string }
  | { kind: "failed"; message: string; retryable: boolean }
  | { kind: "signin" };

type Json = Record<string, unknown>;
export type RazorpayHandlerResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
export type RazorpayInstance = { open(): void; on(event: "payment.failed", cb: (resp: { error?: { description?: string } }) => void): void };
export type RazorpayOptions = {
  key: string; amount: number; currency: string; order_id: string; name: string; description: string;
  prefill?: { email?: string };
  handler: (resp: RazorpayHandlerResponse) => void;
  modal: { ondismiss: () => void; escape?: boolean };
};

export type CheckoutDeps = {
  post(url: string, body: Json): Promise<{ status: number; body: Json }>;
  loadCheckoutScript(): Promise<void>;
  createRazorpay(options: RazorpayOptions): RazorpayInstance;
};

const NOT_COMPLETED = "Checkout closed before the payment was completed.";
const UNCONFIRMED = "We couldn't confirm your payment here. If money was debited, your purchase will be added to your account once the payment is confirmed.";

export async function runCheckout(
  item: CheckoutItem,
  requestId: string,
  deps: CheckoutDeps,
  onState: (s: CheckoutState) => void = () => {}
): Promise<CheckoutState> {
  const done = (s: CheckoutState) => { onState(s); return s; };
  onState({ kind: "starting" });

  let order: { status: number; body: Json };
  try {
    order = await deps.post("/api/payments/orders", { sku: item.sku, with_linkedin_addon: !!item.withLinkedinAddon, request_id: requestId });
  } catch {
    return done({ kind: "failed", message: "Couldn't reach the server. You haven't been charged — please try again.", retryable: true });
  }
  if (order.status === 401) return done({ kind: "signin" });
  if (order.status !== 200) {
    const msg = typeof order.body.message === "string" ? order.body.message : "Checkout isn't available right now. You haven't been charged.";
    return done({ kind: "failed", message: msg, retryable: order.status >= 500 });
  }
  const o = order.body as { razorpay_order_id: string; amount: number; currency: string; key_id: string; description: string; prefill?: { email?: string } };

  try {
    await deps.loadCheckoutScript(); // only after the server created the order
  } catch {
    return done({ kind: "failed", message: "Couldn't load the payment window. You haven't been charged — please try again.", retryable: true });
  }

  return new Promise<CheckoutState>((resolve) => {
    let settled = false;
    let lastFailure: string | null = null;
    const finish = (s: CheckoutState) => { if (!settled) { settled = true; resolve(done(s)); } };

    const rzp = deps.createRazorpay({
      key: o.key_id,
      amount: o.amount,
      currency: o.currency,
      order_id: o.razorpay_order_id,
      name: "Neduresume",
      description: o.description,
      prefill: o.prefill,
      handler: async (resp) => {
        onState({ kind: "verifying" });
        try {
          const v = await deps.post("/api/payments/verify", { ...resp });
          if (v.status === 200) return finish({ kind: "success" });
          if (v.status === 202) return finish({ kind: "pending", message: String(v.body.message ?? UNCONFIRMED) });
          return finish({ kind: "failed", message: typeof v.body.message === "string" ? v.body.message : UNCONFIRMED, retryable: false });
        } catch {
          return finish({ kind: "pending", message: UNCONFIRMED });
        }
      },
      modal: {
        ondismiss: () => finish(lastFailure
          ? { kind: "failed", message: `Payment failed: ${lastFailure}. You can try again.`, retryable: true }
          : { kind: "cancelled", message: NOT_COMPLETED }),
      },
    });
    // Razorpay keeps the window open after a failed attempt so the buyer can
    // retry; remember the reason in case they close it.
    rzp.on("payment.failed", (resp) => { lastFailure = resp?.error?.description ?? "the payment was declined"; });
    rzp.open();
    onState({ kind: "open" });
  });
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let scriptPromise: Promise<void> | null = null;

/** Browser only: injects Razorpay's checkout.js once. */
export function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error("checkout.js failed to load")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}
