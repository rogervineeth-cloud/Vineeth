/**
 * The browser handoff (lib/payments/checkout-client.ts runCheckout), driven
 * with fakes: our server first, Razorpay's script only after an order exists,
 * verification by our server, and honest states for every outcome. Plus the
 * purchase UI gate: buy buttons render only when the server enables checkout.
 */
import * as fs from "fs";
import * as path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runCheckout, type CheckoutDeps, type RazorpayOptions, type CheckoutState } from "@/lib/payments/checkout-client";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }), signOut: async () => ({}) } }) }));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

const ORDER = { razorpay_order_id: "order_Abc123", amount: 24900, currency: "INR", key_id: "rzp_test_AbCdEf123456", description: "Fresher — 5 AI-tailored resumes", prefill: { email: "b@example.com" } };

function harness(opts: { orderStatus?: number; orderBody?: Record<string, unknown>; verifyStatus?: number; verifyBody?: Record<string, unknown>; scriptFails?: boolean; verifyThrows?: boolean } = {}) {
  const log: string[] = [];
  let options: RazorpayOptions | null = null;
  let failedCb: ((r: { error?: { description?: string } }) => void) | null = null;
  const deps: CheckoutDeps = {
    post: async (url, body) => {
      log.push(`post ${url} ${JSON.stringify(body)}`);
      if (url === "/api/payments/orders") return { status: opts.orderStatus ?? 200, body: opts.orderBody ?? ORDER };
      if (opts.verifyThrows) throw new Error("network");
      return { status: opts.verifyStatus ?? 200, body: opts.verifyBody ?? { status: "fulfilled" } };
    },
    loadCheckoutScript: async () => { log.push("load script"); if (opts.scriptFails) throw new Error("blocked"); },
    createRazorpay: (o) => { options = o; log.push(`open ${o.order_id} ${o.amount}`); return { open: () => log.push("rzp.open"), on: (_e, cb) => { failedCb = cb; } }; },
  };
  return { deps, log, options: () => options!, fail: (d: string) => failedCb!({ error: { description: d } }) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("runCheckout", () => {
  it("server order first, then the script, then Razorpay with the SERVER's order/amount/key; success after server verify", async () => {
    const h = harness();
    const states: string[] = [];
    const p = runCheckout({ sku: "fresher" }, "req-1", h.deps, (s) => states.push(s.kind));
    await tick();
    expect(h.log).toEqual([
      'post /api/payments/orders {"sku":"fresher","with_linkedin_addon":false,"request_id":"req-1"}',
      "load script",
      "open order_Abc123 24900",
      "rzp.open",
    ]);
    expect(h.options()).toMatchObject({ key: ORDER.key_id, order_id: ORDER.razorpay_order_id, amount: 24900, currency: "INR", name: "Neduresume" });
    h.options().handler({ razorpay_order_id: "order_Abc123", razorpay_payment_id: "pay_X", razorpay_signature: "f".repeat(64) });
    expect(await p).toEqual({ kind: "success" });
    expect(h.log[h.log.length - 1]).toBe('post /api/payments/verify {"razorpay_order_id":"order_Abc123","razorpay_payment_id":"pay_X","razorpay_signature":"' + "f".repeat(64) + '"}');
    expect(states).toEqual(["starting", "open", "verifying", "success"]);
  });

  it("the request never includes an amount", async () => {
    const h = harness();
    void runCheckout({ sku: "career", withLinkedinAddon: true }, "req-2", h.deps);
    await tick();
    expect(h.log[0]).not.toMatch(/amount|price/);
  });

  it.each([
    [503, { error: "PAYMENTS_UNAVAILABLE", message: "Payments aren't available yet." }, "Payments aren't available yet.", true],
    [409, { error: "REQUEST_ID_REUSED", message: "Please try again." }, "Please try again.", false],
  ])("order refused (%i): honest failure, Razorpay never loaded", async (status, body, message, retryable) => {
    const h = harness({ orderStatus: status, orderBody: body });
    expect(await runCheckout({ sku: "single" }, "r", h.deps)).toEqual({ kind: "failed", message, retryable });
    expect(h.log).toHaveLength(1);
  });

  it("signed out -> signin; Razorpay never loaded", async () => {
    const h = harness({ orderStatus: 401, orderBody: {} });
    expect(await runCheckout({ sku: "single" }, "r", h.deps)).toEqual({ kind: "signin" });
    expect(h.log).toHaveLength(1);
  });

  it("script blocked -> not charged, retryable", async () => {
    const h = harness({ scriptFails: true });
    const s = await runCheckout({ sku: "single" }, "r", h.deps);
    expect(s).toMatchObject({ kind: "failed", retryable: true });
    expect((s as { message: string }).message).toMatch(/haven't been charged/);
  });

  it("closing the window -> 'not completed' (never claims success)", async () => {
    const h = harness();
    const p = runCheckout({ sku: "single" }, "r", h.deps);
    await tick();
    h.options().modal.ondismiss();
    expect(await p).toEqual({ kind: "cancelled", message: "Checkout closed before the payment was completed." });
  });

  it("a failed attempt then closing -> Razorpay's reason, retryable", async () => {
    const h = harness();
    const p = runCheckout({ sku: "single" }, "r", h.deps);
    await tick();
    h.fail("Your card was declined");
    h.options().modal.ondismiss();
    expect(await p).toEqual({ kind: "failed", message: "Payment failed: Your card was declined. You can try again.", retryable: true });
  });

  it.each([
    [{ verifyStatus: 202, verifyBody: { status: "pending", message: "Payment received — confirming." } }, { kind: "pending", message: "Payment received — confirming." }],
    [{ verifyStatus: 400, verifyBody: { error: "SIGNATURE_MISMATCH" } }, { kind: "failed", retryable: false }],
    [{ verifyThrows: true }, { kind: "pending" }],
  ])("verify outcome %j is reported honestly (an unconfirmed payment is not a success)", async (opts, expected) => {
    const h = harness(opts);
    const p = runCheckout({ sku: "single" }, "r", h.deps);
    await tick();
    h.options().handler({ razorpay_order_id: "order_Abc123", razorpay_payment_id: "pay_X", razorpay_signature: "f".repeat(64) });
    const s = (await p) as CheckoutState;
    expect(s).toMatchObject(expected);
    expect(s.kind).not.toBe("success");
  });
});

describe("purchase UI gate", () => {
  const render = async (checkoutEnabled: boolean) => {
    const { default: PricingClient } = await import("@/app/pricing/PricingClient");
    return renderToStaticMarkup(createElement(PricingClient, { pricingV2: true, checkoutEnabled }));
  };

  it("default (disabled): only disabled 'Payments coming soon' controls; no buy button", async () => {
    const { default: PricingClient } = await import("@/app/pricing/PricingClient");
    const html = renderToStaticMarkup(createElement(PricingClient, { pricingV2: true }));
    expect(html.match(/data-payment-cta="disabled"/g)).toHaveLength(5);
    expect(html).not.toMatch(/data-payment-cta="enabled"|Buy /);
    expect(html).toContain("Payments aren&#x27;t live yet");
  });

  it("enabled by the server: 5 buy buttons (4 packs + LinkedIn), no 'coming soon', no 'not live' notice", async () => {
    const html = await render(true);
    expect(html.match(/data-payment-cta="enabled"/g)).toHaveLength(5);
    expect(html).not.toMatch(/data-payment-cta="disabled"|Payments coming soon|Payments aren&#x27;t live yet/);
    for (const name of ["Single", "Fresher", "Job Hunter", "Career Pack", "LinkedIn Profile Rewrite"]) expect(html).toContain(`>Buy ${name}<`);
  });

  it("the pages decide from the server config, never from the browser", () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    expect(read("app/pricing/page.tsx")).toMatch(/checkoutEnabled=\{isCheckoutAvailable\(\)\}/);
    expect(read("app/page.tsx")).toMatch(/const checkoutEnabled = isCheckoutAvailable\(\);/);
    expect(read("components/pricing/PurchaseCta.tsx")).toMatch(/return enabled\s*\? <BuyButton[\s\S]*: <PaymentsComingSoonButton/);
  });
});
