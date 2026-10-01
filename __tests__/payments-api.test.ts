/**
 * The payment API routes end to end, with Razorpay's REST API mocked (global
 * fetch) and the database replaced by the in-memory double of migration 016
 * (helpers/fake-payment-store.ts). No real external call is possible: an
 * unexpected fetch fails the test.
 *
 * Covers: disabled by default, config/mode guard, auth, server pricing (price
 * tampering ignored), request-id idempotency, signature mismatch, wrong owner,
 * wrong order/amount/currency/status, duplicate verify and webhook,
 * webhook-before-verify, concurrent verify+webhook, retry of a failed webhook
 * delivery, refunds without revocation — and never more than one grant.
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { createHmac, randomUUID } from "crypto";

const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => { throw new Error("tests must not reach the real store"); }),
}));
import { createFakePaymentStore } from "./helpers/fake-payment-store";
const mockStore = createFakePaymentStore();
let mockStoreOverride: Partial<typeof mockStore> | null = null;
jest.mock("@/lib/payments/store", () => ({
  paymentStore: () => (mockStoreOverride ? { ...mockStore, ...mockStoreOverride } : mockStore),
}));

import { POST as createOrder } from "@/app/api/payments/orders/route";
import { POST as verify } from "@/app/api/payments/verify/route";
import { POST as webhook } from "@/app/api/payments/razorpay/webhook/route";

const KEY_ID = "rzp_test_AbCdEf123456";
const KEY_SECRET = "test-key-secret-not-real";
const WH_SECRET = "test-webhook-secret-not-real";
const BUYER = { id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com" };
const OTHER = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.com" };

// ── Mock Razorpay REST API ──────────────────────────────────────────────────
type Payment = { id: string; order_id: string | null; amount: number; currency: string; status: string };
const rzp = {
  orders: [] as { id: string; amount: number; currency: string; receipt: string; notes: Record<string, string> }[],
  payments: new Map<string, Payment>(),
  calls: [] as { method: string; url: string; auth: string | null }[],
  failOrders: 0,
  orderAmountOverride: null as number | null,
  failPaymentFetch: false,
};
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (!u.startsWith("https://api.razorpay.com/v1/")) throw new Error(`unexpected fetch ${u}`);
  const method = init?.method ?? "GET";
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
  rzp.calls.push({ method, url: u, auth });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (method === "POST" && u.endsWith("/orders")) {
    if (rzp.failOrders > 0) { rzp.failOrders--; return json(500, { error: { description: "server error" } }); }
    const b = JSON.parse(String(init!.body));
    const order = { id: `order_${randomUUID().replace(/-/g, "").slice(0, 14)}`, amount: rzp.orderAmountOverride ?? b.amount, currency: b.currency, receipt: b.receipt, notes: b.notes, status: "created" };
    rzp.orders.push(order);
    return json(200, order);
  }
  const m = u.match(/\/payments\/(pay_\w+)$/);
  if (method === "GET" && m) {
    if (rzp.failPaymentFetch) return json(502, {});
    const p = rzp.payments.get(m[1]);
    return p ? json(200, p) : json(404, { error: { description: "not found" } });
  }
  throw new Error(`unexpected Razorpay call ${method} ${u}`);
});

// ── Helpers ─────────────────────────────────────────────────────────────────
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }) as unknown as NextRequest;
const sigFor = (orderId: string, payId: string, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${orderId}|${payId}`).digest("hex");
const payId = () => `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

async function order(body: Record<string, unknown>, user = BUYER) {
  mockGetUser.mockResolvedValue({ data: { user } });
  const res = await createOrder(post("http://localhost/api/payments/orders", body));
  return { status: res.status, body: await res.json() };
}
async function doVerify(body: Record<string, unknown>, user = BUYER) {
  mockGetUser.mockResolvedValue({ data: { user } });
  const res = await verify(post("http://localhost/api/payments/verify", body));
  return { status: res.status, body: await res.json() };
}
function signedWebhook(event: string, entities: Record<string, unknown>, eventId = `evt_${randomUUID()}`, secret = WH_SECRET) {
  const raw = JSON.stringify({ entity: "event", event, payload: Object.fromEntries(Object.entries(entities).map(([k, v]) => [k, { entity: v }])) });
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  return { raw, sig, eventId };
}
async function sendWebhook(w: { raw: string; sig: string; eventId: string | null }) {
  const headers: Record<string, string> = { "x-razorpay-signature": w.sig };
  if (w.eventId) headers["x-razorpay-event-id"] = w.eventId;
  const res = await webhook(post("http://localhost/api/payments/razorpay/webhook", w.raw, headers));
  return { status: res.status, body: await res.json() };
}
/** A paid order: our order + a captured payment in the mock API. */
async function paidOrder(sku = "fresher", withAddon = false, user = BUYER, overrides: Partial<Payment> = {}) {
  const o = await order({ sku, with_linkedin_addon: withAddon, request_id: randomUUID() }, user);
  expect(o.status).toBe(200);
  const p: Payment = { id: payId(), order_id: o.body.razorpay_order_id, amount: o.body.amount, currency: "INR", status: "captured", ...overrides };
  rzp.payments.set(p.id, p);
  return { o: o.body, p, sig: sigFor(o.body.razorpay_order_id, p.id) };
}
const grantsFor = (orderId: string) => mockStore.plans.filter((g) => g.orderId === orderId).length + mockStore.addons.filter((a) => a.orderId === orderId).length;

const ENV_KEYS = ["PAYMENTS_ENABLED", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "VERCEL_ENV"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;
beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; global.fetch = fetchMock as unknown as typeof fetch; });
afterAll(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } global.fetch = realFetch; });
beforeEach(() => {
  Object.assign(process.env, { PAYMENTS_ENABLED: "true", RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET });
  delete process.env.VERCEL_ENV;
  mockStore.reset();
  mockStoreOverride = null;
  rzp.orders = []; rzp.payments = new Map(); rzp.calls = []; rzp.failOrders = 0; rzp.orderAmountOverride = null; rzp.failPaymentFetch = false;
  fetchMock.mockClear();
  mockGetUser.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => (console.error as jest.Mock).mockRestore?.());

// ── Disabled / config guard ─────────────────────────────────────────────────
describe("unavailable unless strictly configured", () => {
  const all = async () => [
    (await createOrder(post("http://localhost/api/payments/orders", { sku: "single", request_id: randomUUID() }))).status,
    (await verify(post("http://localhost/api/payments/verify", {}))).status,
    (await webhook(post("http://localhost/api/payments/razorpay/webhook", "{}"))).status,
  ];

  it.each([
    ["not enabled (default)", { PAYMENTS_ENABLED: undefined }],
    ["enabled but no keys", { RAZORPAY_KEY_ID: undefined }],
    ["missing webhook secret", { RAZORPAY_WEBHOOK_SECRET: undefined }],
    ["live key in preview", { RAZORPAY_KEY_ID: "rzp_live_AbCdEf123456", VERCEL_ENV: "preview" }],
    ["test key in production", { VERCEL_ENV: "production" }],
  ])("%s: every endpoint 503, no auth lookup, no Razorpay call, nothing stored", async (_l, env) => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    mockGetUser.mockResolvedValue({ data: { user: BUYER } });
    expect(await all()).toEqual([503, 503, 503]);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStore.orders).toHaveLength(0);
  });
});

// ── Orders ──────────────────────────────────────────────────────────────────
describe("POST /api/payments/orders", () => {
  it("401 when signed out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await createOrder(post("http://localhost/api/payments/orders", { sku: "single", request_id: randomUUID() }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prices on the server: a client amount is ignored (Fresher + LinkedIn = ₹648)", async () => {
    const o = await order({ sku: "fresher", with_linkedin_addon: true, request_id: randomUUID(), amount: 100, amount_paise: 1, price: 1 });
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ amount: 64800, currency: "INR", key_id: KEY_ID });
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent).toMatchObject({ amount: 64800, currency: "INR", receipt: mockStore.orders[0].id });
    expect(sent.notes).toMatchObject({ payment_order_id: mockStore.orders[0].id, user_id: BUYER.id, sku: "fresher" });
    expect(rzp.calls[0].auth).toBe("Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64"));
    expect(JSON.stringify(o.body)).not.toContain(KEY_SECRET);
    expect(JSON.stringify(o.body)).not.toContain(WH_SECRET);
  });

  it.each([
    [{ sku: "unlimited" }], [{ sku: "linkedin_rewrite", with_linkedin_addon: true }], [{ sku: "beta" }], [{ sku: "single", request_id: "nope" }], [{}],
  ])("rejects invalid purchase %j before anything is created", async (body) => {
    const o = await order({ request_id: randomUUID(), ...body });
    expect(o.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStore.orders).toHaveLength(0);
  });

  it("the same request id returns the same order (one Razorpay order); reuse for a different purchase is 409", async () => {
    const id = randomUUID();
    const a = await order({ sku: "single", request_id: id });
    const b = await order({ sku: "single", request_id: id });
    expect(b.body.razorpay_order_id).toBe(a.body.razorpay_order_id);
    expect(rzp.orders).toHaveLength(1);
    expect((await order({ sku: "career", request_id: id })).status).toBe(409);
    expect(mockStore.orders).toHaveLength(1);
  });

  it("concurrent creates for one attempt end with one stored Razorpay order id", async () => {
    const id = randomUUID();
    mockGetUser.mockResolvedValue({ data: { user: BUYER } });
    const res = await Promise.all([1, 2, 3].map(() => createOrder(post("http://localhost/api/payments/orders", { sku: "single", request_id: id }))));
    const ids = await Promise.all(res.map(async (r) => (await r.json()).razorpay_order_id));
    expect(new Set(ids).size).toBe(1);
    expect(mockStore.orders).toHaveLength(1);
  });

  it("a Razorpay failure is 502 (not charged), and retrying the same attempt then succeeds", async () => {
    rzp.failOrders = 1;
    const id = randomUUID();
    const a = await order({ sku: "career", request_id: id });
    expect(a.status).toBe(502);
    expect(a.body.message).toMatch(/haven't been charged/);
    const b = await order({ sku: "career", request_id: id });
    expect(b.status).toBe(200);
    expect(mockStore.orders).toHaveLength(1);
  });

  it("a Razorpay order with a different amount is not attached", async () => {
    rzp.orderAmountOverride = 100;
    const o = await order({ sku: "career", request_id: randomUUID() });
    expect(o.status).toBe(502);
    expect(mockStore.orders[0].razorpayOrderId).toBeNull();
  });
});

// ── Verify ──────────────────────────────────────────────────────────────────
describe("POST /api/payments/verify", () => {
  it("valid signature + captured payment for this order and amount -> granted once", async () => {
    const { o, p, sig } = await paidOrder("fresher");
    const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig });
    expect(v).toEqual({ status: 200, body: { status: "fulfilled", already: false } });
    expect(mockStore.plans).toEqual([expect.objectContaining({ userId: BUYER.id, planType: "fresher", credits: 5, isTest: true, paymentId: p.id })]);
  });

  it("duplicate verify -> 'already', no second grant, no second Razorpay lookup", async () => {
    const { o, p, sig } = await paidOrder("single");
    const body = { razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig };
    await doVerify(body);
    const lookups = rzp.calls.filter((c) => c.method === "GET").length;
    expect(await doVerify(body)).toEqual({ status: 200, body: { status: "fulfilled", already: true } });
    expect(rzp.calls.filter((c) => c.method === "GET").length).toBe(lookups);
    expect(grantsFor(mockStore.orders[0].id)).toBe(1);
  });

  it("signature mismatch -> 400 before any Razorpay lookup; nothing granted", async () => {
    const { o, p } = await paidOrder();
    for (const sig of [sigFor(o.razorpay_order_id, p.id, "wrong-secret"), sigFor("order_other", p.id), "0".repeat(64)]) {
      const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig });
      expect(v.status).toBe(400);
      expect(v.body.error).toBe("SIGNATURE_MISMATCH");
    }
    expect(rzp.calls.filter((c) => c.method === "GET")).toHaveLength(0);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("someone else's order -> 404 (even with a valid signature)", async () => {
    const { o, p, sig } = await paidOrder("career", false, BUYER);
    const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig }, OTHER);
    expect(v.status).toBe(404);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("a payment that belongs to a different order -> 400 ORDER_MISMATCH", async () => {
    const { o, p } = await paidOrder("fresher", false, BUYER, { order_id: "order_someOtherOrder1" });
    const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sigFor(o.razorpay_order_id, p.id) });
    expect(v.body.error).toBe("ORDER_MISMATCH");
    expect(mockStore.plans).toHaveLength(0);
  });

  it.each([
    ["amount", { amount: 100 }, 400, "AMOUNT_MISMATCH"],
    ["currency", { currency: "USD" }, 400, "AMOUNT_MISMATCH"],
    ["status failed", { status: "failed" }, 402, "PAYMENT_NOT_CAPTURED"],
    ["status created", { status: "created" }, 402, "PAYMENT_NOT_CAPTURED"],
  ])("wrong %s -> no grant", async (_l, override, status, error) => {
    const { o, p, sig } = await paidOrder("fresher", false, BUYER, override);
    const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig });
    expect(v.status).toBe(status);
    expect(v.body.error).toBe(error);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("authorized but not yet captured -> 202 pending, no grant", async () => {
    const { o, p, sig } = await paidOrder("fresher", false, BUYER, { status: "authorized" });
    const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig });
    expect(v.status).toBe(202);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("Razorpay lookup failure -> 502, no grant", async () => {
    const { o, p, sig } = await paidOrder();
    rzp.failPaymentFetch = true;
    expect((await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig })).status).toBe(502);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("malformed body -> 400; signed out -> 401", async () => {
    expect((await doVerify({ razorpay_order_id: "x", razorpay_payment_id: "y", razorpay_signature: "z" })).status).toBe(400);
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await verify(post("http://localhost/api/payments/verify", {}))).status).toBe(401);
  });
});

// ── Webhook ─────────────────────────────────────────────────────────────────
describe("POST /api/payments/razorpay/webhook", () => {
  const captured = (p: Payment) => signedWebhook("payment.captured", { payment: p });

  it("bad or missing signature -> 400, nothing recorded or granted", async () => {
    const { p } = await paidOrder();
    const w = captured(p);
    expect((await sendWebhook({ ...w, sig: "0".repeat(64) })).status).toBe(400);
    expect((await sendWebhook({ ...w, sig: createHmac("sha256", "wrong").update(w.raw).digest("hex") })).status).toBe(400);
    expect((await sendWebhook({ ...w, raw: w.raw.replace("captured", "captured ") })).status).toBe(400);
    expect(mockStore.events.size).toBe(0);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("missing event id -> 400", async () => {
    const { p } = await paidOrder();
    expect((await sendWebhook({ ...captured(p), eventId: null })).status).toBe(400);
  });

  it("payment.captured grants once; the same event delivered again is a duplicate", async () => {
    const { p } = await paidOrder("job_hunter");
    const w = captured(p);
    expect((await sendWebhook(w)).body).toEqual({ status: "processed" });
    expect((await sendWebhook(w)).body).toEqual({ status: "duplicate" });
    expect(mockStore.plans).toEqual([expect.objectContaining({ planType: "job_hunter", credits: 12 })]);
  });

  it("order.paid also fulfils (and is idempotent with payment.captured for the same payment)", async () => {
    const { o, p } = await paidOrder("career", true);
    await sendWebhook(signedWebhook("order.paid", { payment: p, order: { id: o.razorpay_order_id } }));
    await sendWebhook(captured(p));
    expect(grantsFor(mockStore.orders[0].id)).toBe(2); // the pack + the bundled add-on, once
    expect(mockStore.plans).toHaveLength(1);
    expect(mockStore.addons).toHaveLength(1);
  });

  it("webhook before verify: one grant; verify then reports 'already'", async () => {
    const { o, p, sig } = await paidOrder("fresher");
    await sendWebhook(captured(p));
    const v = await doVerify({ razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig });
    expect(v).toEqual({ status: 200, body: { status: "fulfilled", already: true } });
    expect(mockStore.plans).toHaveLength(1);
  });

  it("verify and webhook at the same time: one grant", async () => {
    const { o, p, sig } = await paidOrder("fresher");
    mockGetUser.mockResolvedValue({ data: { user: BUYER } });
    const results = await Promise.all([
      verify(post("http://localhost/api/payments/verify", { razorpay_order_id: o.razorpay_order_id, razorpay_payment_id: p.id, razorpay_signature: sig })),
      sendWebhook(captured(p)),
      sendWebhook(captured(p)),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(mockStore.plans).toHaveLength(1);
  });

  it("a delivery that fails mid-processing returns 500 and is processed on Razorpay's retry", async () => {
    const { p } = await paidOrder("single");
    const w = captured(p);
    mockStoreOverride = { fulfil: async () => { throw new Error("db down"); } };
    expect((await sendWebhook(w)).status).toBe(500);
    expect(mockStore.plans).toHaveLength(0);
    mockStoreOverride = null;
    expect((await sendWebhook(w)).body).toEqual({ status: "processed" });
    expect(mockStore.plans).toHaveLength(1);
    expect(mockStore.events.get(w.eventId)).toEqual({ processed: true, attempts: 2 });
  });

  it("a signed event with the wrong amount grants nothing (the database re-checks)", async () => {
    const { p } = await paidOrder("career");
    await sendWebhook(captured({ ...p, amount: 100 }));
    expect(mockStore.plans).toHaveLength(0);
  });

  it("standalone LinkedIn Rewrite: one add-on, no credits", async () => {
    const { p } = await paidOrder("linkedin_rewrite");
    await sendWebhook(captured(p));
    expect(mockStore.addons).toHaveLength(1);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("payment.failed records the reason and grants nothing", async () => {
    const { o, p } = await paidOrder();
    await sendWebhook(signedWebhook("payment.failed", { payment: { ...p, status: "failed", error_description: "Card declined" } }));
    expect(mockStore.failures).toEqual([{ orderId: o.razorpay_order_id, error: "Card declined" }]);
    expect(mockStore.plans).toHaveLength(0);
  });

  it("refunds are recorded without revoking credits (policy pending)", async () => {
    const { p } = await paidOrder("fresher");
    await sendWebhook(captured(p));
    await sendWebhook(signedWebhook("refund.processed", { refund: { id: "rfnd_1", payment_id: p.id, amount: 24900, status: "processed" } }));
    expect(mockStore.refunds.get("rfnd_1")).toMatchObject({ amount: 24900, status: "processed" });
    expect(mockStore.plans).toHaveLength(1);
  });

  it("unrelated events are acknowledged and ignored", async () => {
    expect((await sendWebhook(signedWebhook("subscription.charged", {}))).body).toEqual({ status: "processed" });
  });
});

describe("no grants from the browser", () => {
  it("client checkout code never touches entitlement tables or the service client", () => {
    for (const f of ["lib/payments/checkout-client.ts", "components/pricing/BuyButton.tsx", "components/pricing/PurchaseCta.tsx"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(src).not.toMatch(/user_plans|user_addons|createServiceClient|supabase|fulfil|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET/);
    }
  });
});
