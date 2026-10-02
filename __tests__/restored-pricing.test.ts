/**
 * Paid pricing restored on the landing page and /pricing exactly as it was
 * before commit 7709d56 (Free Beta) hid it — with payments still disabled.
 *
 * RECOVERED SOURCE (git history, commit bf32f66 = 7709d56^):
 *   - lib/plan-config.ts  PLANS / ADDONS (unchanged on main since then)
 *   - app/page.tsx        `plans` array: the landing page's paid cards
 *   - app/pricing/PricingClient.tsx  planFeatures(), PlanCard, LinkedinAddonCard
 * The expected values below are copied from those files. When the git history
 * is available, the test also re-reads bf32f66 and checks them again.
 *
 * Rendering: the real components are rendered to HTML (react-dom/server) with
 * Next/Supabase mocked. useEffect does not run there, so nothing is fetched.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never) }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }), signOut: async () => ({}) } }) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ count: 0, data: [], error: null, then: (r: (v: unknown) => unknown) => Promise.resolve({ count: 0, data: [], error: null }).then(r) }) }) }),
}));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { PLANS, ADDONS, FREE_BETA_LABEL } from "@/lib/plan-config";
import { PAID_TIERS, planFeatures, PAYMENTS_COMING_SOON, PAYMENTS_LIVE } from "@/lib/pricing-display";

const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// ── The recovered scheme (from bf32f66) ──────────────────────────────────────
const FEATURES = (n: number) => [`${n} AI-tailored resume${n !== 1 ? "s" : ""}`, "Unlimited PDF downloads", "Live ATS keyword score", "1-year validity"];
const RECOVERED = [
  { slug: "single", name: "Single", priceInr: 99, aiGenerations: 1, badge: null, landing: { price: "₹99", resumes: "1 AI-tailored resume", popular: false } },
  { slug: "fresher", name: "Fresher", priceInr: 249, aiGenerations: 5, badge: "Most popular", landing: { price: "₹249", resumes: "5 AI-tailored resumes", popular: true } },
  { slug: "job_hunter", name: "Job Hunter", priceInr: 599, aiGenerations: 12, badge: null, landing: { price: "₹599", resumes: "12 AI-tailored resumes", popular: false } },
  { slug: "career", name: "Career Pack", priceInr: 999, aiGenerations: 25, badge: "Best value", landing: { price: "₹999", resumes: "25 AI-tailored resumes", popular: false } },
] as const;
const RECOVERED_ADDON = { id: "linkedin_rewrite", name: "LinkedIn Profile Rewrite", priceInr: 499, bundlePriceInr: 399 };

describe("displayed tiers match the recovered source", () => {
  it("PLANS / ADDONS are the recovered tiers, prices and credits", () => {
    expect(PLANS.map((p) => ({ type: p.type, name: p.name, priceInr: p.priceInr, aiGenerations: p.aiGenerations, badge: p.badge })))
      .toEqual(RECOVERED.map((r) => ({ type: r.slug, name: r.name, priceInr: r.priceInr, aiGenerations: r.aiGenerations, badge: r.badge })));
    expect(ADDONS).toEqual([RECOVERED_ADDON]);
  });

  it("the landing page's cards are the recovered cards (name, price, credits, popular, features)", () => {
    expect(PAID_TIERS).toEqual(RECOVERED.map((r) => ({ slug: r.slug, name: r.name, ...r.landing, features: FEATURES(r.aiGenerations) })));
  });

  it("the /pricing card features are the recovered planFeatures()", () => {
    for (const p of PLANS) expect(planFeatures(p)).toEqual(FEATURES(p.aiGenerations));
  });

  // Re-derive from git history when it is there (skipped in a shallow clone).
  let historic: { landing: string; config: string } | null = null;
  try {
    const show = (f: string) => execFileSync("git", ["show", `bf32f66:${f}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    historic = { landing: show("app/page.tsx"), config: show("lib/plan-config.ts") };
  } catch { /* no history */ }
  (historic ? it : it.skip)("matches bf32f66 itself: lib/plan-config.ts PLANS/ADDONS and app/page.tsx paid cards", () => {
    const h = historic!;
    for (const r of RECOVERED) {
      expect(h.config).toMatch(new RegExp(`type: "${r.slug}",\\s+name: "${r.name}",\\s+priceInr: ${r.priceInr},\\s+aiGenerations: ${r.aiGenerations},\\s+badge: ${r.badge ? `"${r.badge}"` : "null"}`));
      expect(h.landing).toMatch(new RegExp(`slug: "${r.slug}",\\s+name: "${r.name}",\\s+price: "${r.landing.price}",\\s+resumes: "${r.landing.resumes}",\\s+popular: ${r.landing.popular},`));
      expect(h.landing).toContain(`features: [${FEATURES(r.aiGenerations).map((f) => `"${f}"`).join(", ")}]`);
    }
    expect(h.config).toMatch(/priceInr: 499,\s+bundlePriceInr: 399/);
    expect(h.landing).toContain("+ LinkedIn Profile Rewrite add-on — ₹499 standalone, ₹399 bundled with any plan");
    expect(h.landing).toContain("All plans valid 1 year · No subscription · Pay once, use anytime");
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
const comingSoon = (html: string) => buttons(html).filter((b) => b.includes(PAYMENTS_COMING_SOON));

describe("the pages render the restored pricing, with payments disabled", () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => { fetchSpy = jest.spyOn(global, "fetch").mockImplementation(() => { throw new Error("no network in pricing render"); }); });
  afterEach(() => fetchSpy.mockRestore());

  async function landing() {
    const { default: Home } = await import("@/app/page");
    return renderToStaticMarkup(await Home());
  }
  async function pricing(testMode = false) {
    jest.resetModules();
    process.env.NEXT_PUBLIC_TEST_MODE = testMode ? "true" : "";
    // Fresh module graph (so NEXT_PUBLIC_TEST_MODE is read at import), with
    // the renderer and React from the same graph.
    const React = await import("react");
    const Server = await import("react-dom/server");
    const { default: PricingClient } = await import("@/app/pricing/PricingClient");
    return Server.renderToStaticMarkup(React.createElement(PricingClient, { pricingV2: true }));
  }

  it("landing page: all 4 paid tiers with recovered prices, credits and features; the Free Beta offer separately", async () => {
    const html = await landing();
    for (const r of RECOVERED) {
      expect(html).toContain(`>${r.name}<`);
      expect(html).toContain(`>${r.landing.price}<`);
      expect(html).toContain(`>${r.landing.resumes}<`);
      for (const f of FEATURES(r.aiGenerations)) expect(html).toContain(`>${f}<`);
    }
    expect(html).toContain(">Most popular<");
    expect(html).toContain("Simple pricing");
    expect(html).toContain("All plans valid 1 year · No subscription · Pay once, use anytime");
    expect(html).toContain("+ LinkedIn Profile Rewrite add-on — ₹499 standalone, ₹399 bundled with any plan");
    expect(html).toContain(FREE_BETA_LABEL);
    expect(html).toContain("Payments aren&#x27;t live yet");
  });

  it("landing page: each paid card's only control is a disabled 'Payments coming soon' button", async () => {
    const html = await landing();
    const cta = comingSoon(html);
    expect(cta).toHaveLength(4);
    for (const b of cta) expect(b).toMatch(/ disabled=""/);
    expect(html).not.toMatch(/Get started<\/a>|href="\/pricing#/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("/pricing: the 4 tiers, prices (₹99/₹249/₹599/₹999), badges and the ₹499 add-on render, plus the Free Beta offer", async () => {
    const html = await pricing();
    for (const r of RECOVERED) {
      expect(html).toContain(`>${r.name}<`);
      expect(html).toContain(`>₹${r.priceInr}<`);
      for (const f of FEATURES(r.aiGenerations)) expect(html).toContain(`>${f}<`);
    }
    expect(html).toContain(">Most popular<");
    expect(html).toContain(">Best value<");
    expect(html).toContain("LinkedIn Profile Rewrite");
    expect(html).toContain(">₹499<");
    expect(html).toContain("Add LinkedIn Rewrite — ₹399");
    expect(html).toContain(FREE_BETA_LABEL);
    expect(html).toContain("these plans can&#x27;t be bought today");
    // Order: Free Beta (available now) → free ATS review → "Paid plans" → paid cards → LinkedIn add-on.
    const at = (s: string) => html.indexOf(s);
    expect(at(FREE_BETA_LABEL)).toBeLessThan(at("Free ATS review"));
    expect(at("Free ATS review")).toBeLessThan(at(">Paid plans<"));
    expect(at(">Paid plans<")).toBeLessThan(at('id="single"'));
    expect(at('id="career"')).toBeLessThan(at("LinkedIn Profile Rewrite</p>"));
  });

  it("/pricing: 5 purchase controls (4 plans + LinkedIn), all disabled; no 'Choose…'/'Buy…'/grant buttons, even in TEST_MODE", async () => {
    for (const testMode of [false, true]) {
      const html = await pricing(testMode);
      const cta = comingSoon(html);
      expect(cta).toHaveLength(5);
      for (const b of cta) expect(b).toMatch(/ disabled=""/);
      expect(html).not.toMatch(/Choose (Single|Fresher|Job Hunter|Career Pack)|Buy LinkedIn Rewrite|Grant test plan|TEST MODE/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("no payment call is possible from the pricing UI", () => {
  const files = ["app/pricing/PricingClient.tsx", "app/pricing/page.tsx", "app/page.tsx", "components/pricing/PaymentsComingSoonButton.tsx", "lib/pricing-display.ts", "components/beta/FreeBetaCard.tsx"];

  it("payments are flagged off", () => {
    expect(PAYMENTS_LIVE).toBe(false);
  });

  it.each(files)("%s has no fetch, checkout, order, grant or Razorpay call", (f) => {
    const code = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n"); // ignore comments
    expect(code).not.toMatch(/\bfetch\(|\/api\/checkout|\/api\/dev\/grant|grant-test-plan|razorpay|checkout_start|createOrder|\.rpc\(/i);
  });

  it("the purchase button is disabled and has no handler or link", () => {
    const btn = read("components", "pricing", "PaymentsComingSoonButton.tsx");
    expect(btn).toMatch(/\bdisabled\b/);
    expect(btn).not.toMatch(/onClick|href=|asChild/);
  });
});
