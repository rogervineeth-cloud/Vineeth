// Server-only. The two Razorpay REST calls the foundation needs, over fetch
// with HTTP Basic auth (key id : key secret). No SDK dependency. Tests mock
// fetch; nothing here runs unless payments are configured and enabled.

const API = "https://api.razorpay.com/v1";

export type RazorpayCredentials = { keyId: string; keySecret: string };

export type RazorpayOrder = { id: string; amount: number; currency: string; receipt: string; status: string };
export type RazorpayPayment = { id: string; order_id: string | null; amount: number; currency: string; status: string };

export class RazorpayApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function authHeader(c: RazorpayCredentials) {
  return "Basic " + Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64");
}

async function call<T>(c: RazorpayCredentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: authHeader(c), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    // Razorpay's error body describes the request, never our secret; keep it short.
    const text = await res.text().catch(() => "");
    throw new RazorpayApiError(res.status, `Razorpay ${method} ${path.split("/")[1]} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function createRazorpayOrder(
  c: RazorpayCredentials,
  order: { amountPaise: number; receipt: string; notes: Record<string, string> }
): Promise<RazorpayOrder> {
  return call<RazorpayOrder>(c, "POST", "/orders", { amount: order.amountPaise, currency: "INR", receipt: order.receipt, notes: order.notes });
}

export function fetchRazorpayPayment(c: RazorpayCredentials, paymentId: string): Promise<RazorpayPayment> {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new RazorpayApiError(400, "malformed payment id");
  return call<RazorpayPayment>(c, "GET", `/payments/${paymentId}`);
}
