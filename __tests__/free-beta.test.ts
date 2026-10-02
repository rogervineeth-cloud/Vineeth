/**
 * Free Beta: 3 resume generations per account until payments are integrated.
 *
 * Database guarantees (one grant per account, no reset, coexistence with paid
 * plans, charging) are tested against real PostgreSQL in
 * migration-015-sql.test.ts. Here: the server helper, the claim endpoint, the
 * generate route's grant-before-check, the client plan summary, and that the
 * UI offers nothing for sale (Jest has no DOM; UI by reading the source).
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";

const mockRpc = jest.fn();
const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => ({ rpc: (...a: unknown[]) => mockRpc(...a) })),
}));

import { ensureBetaCredits } from "@/lib/beta";
import { POST as claim } from "@/app/api/beta/claim/route";
import { summarisePlans, loadPlansEnsuringBeta, type PlanRow } from "@/lib/beta-client";
import { BETA_CREDITS, FREE_BETA_LABEL, BETA_EXHAUSTED_MESSAGE, PLAN_ALLOTMENTS, FREE_BETA } from "@/lib/plan-config";
import { FREE_BETA_FEATURES } from "@/components/beta/FreeBetaCard";

const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => { mockRpc.mockReset(); mockGetUser.mockReset(); });

describe("ensureBetaCredits (server)", () => {
  it("calls the migration's function for this account and reports the outcome", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(ensureBetaCredits(USER)).resolves.toBe("granted");
    expect(mockRpc).toHaveBeenCalledWith("grant_beta_credits", { p_user_id: USER });
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(ensureBetaCredits(USER)).resolves.toBe("existing");
  });

  it("never throws: a missing migration or DB error is 'unavailable' (no credits invented)", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "function public.grant_beta_credits does not exist" } });
    await expect(ensureBetaCredits(USER)).resolves.toBe("unavailable");
    mockRpc.mockRejectedValueOnce(new Error("network"));
    await expect(ensureBetaCredits(USER)).resolves.toBe("unavailable");
  });

  it("the function name and parameter match migrations 015/018 (018 grants exactly 1)", () => {
    expect(read("supabase", "migrations", "015_free_beta_credits.sql")).toMatch(/values \(p_user_id, 'beta', 3, 0,/);
    const sql = read("supabase", "migrations", "018_free_preview_entitlement.sql");
    expect(sql).toMatch(/create or replace function public\.grant_beta_credits\(p_user_id uuid\)/);
    expect(sql).toMatch(new RegExp(`values \\(p_user_id, 'beta', ${BETA_CREDITS}, 0,`));
    expect(PLAN_ALLOTMENTS.beta).toBe(BETA_CREDITS);
    expect(BETA_CREDITS).toBe(1);
  });
});

describe("POST /api/beta/claim", () => {
  it("401 when signed out; nothing granted", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await claim()).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("an unverified account gets nothing (403), no grant attempted", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER, email_confirmed_at: null } } });
    const res = await claim();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "email_not_verified" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("grants for the session's own (verified) account only, idempotently", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER, email_confirmed_at: "2026-10-01T00:00:00Z" } } });
    mockRpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await (await claim()).json()).toEqual({ status: "granted" });
    expect(await (await claim()).json()).toEqual({ status: "existing" });
    expect(mockRpc.mock.calls.every(([, args]) => (args as { p_user_id: string }).p_user_id === USER)).toBe(true);
  });

  it("503 when the grant is unavailable", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER, email_confirmed_at: "2026-10-01T00:00:00Z" } } });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await claim()).status).toBe(503);
  });
});

describe("generate route grants the beta credits before its credit check", () => {
  const route = read("app", "api", "generate-resume", "route.ts");
  it("ensureBetaCredits runs only for verified non-creator accounts, before the credit reservation", () => {
    expect(route).toMatch(/const emailVerified = !!authUser\.email_confirmed_at;\s*if \(!isCreator && emailVerified\) await ensureBetaCredits\(userId\);/);
    expect(route.indexOf("await ensureBetaCredits(userId);")).toBeLessThan(route.indexOf("store.begin(userId, request_key, fingerprint, !isCreator)"));
    expect(route).not.toMatch(/canGenerateResume|canGenerateFreeRegen/);
  });

  it("end to end: a new account (no plan) generates after the grant; with the grant unavailable it still gets 402", async () => {
    jest.resetModules();
    jest.doMock("@/lib/plans", () => ({ userOwnsResume: jest.fn(async () => false) }));
    // The store's begin RPC fails like an unapplied migration (no credits are invented).
    const { POST } = await import("@/app/api/generate-resume/route");
    mockGetUser.mockResolvedValue({ data: { user: { id: USER, email: "new@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" } } });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "not applied" } });
    const body = JSON.stringify({ request_key: "3f1c7a0e-8f53-4d6a-9a53-2d7f1e6b1c11", jd_text: "x".repeat(220),
      user_profile: { full_name: "New User", email: "new@example.com", projects: [{ name: "P", description: "Built P.", tech: [] }] } });
    const res = await POST(new Request("http://localhost/api/generate-resume", { method: "POST", headers: { "Content-Type": "application/json" }, body }) as unknown as NextRequest);
    // grant unavailable -> begin finds no credit (or fails closed): never a model call.
    expect([402, 503]).toContain(res.status);
    expect(mockRpc).toHaveBeenCalledWith("grant_beta_credits", { p_user_id: USER });
  });
});

describe("client plan summary", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const beta = (used: number): PlanRow => ({ plan_type: "beta", resumes_allotted: 3, resumes_used: used, purchased_at: "2026-09-27T10:00:00Z", expires_at: "2027-09-27T10:00:00Z" });

  it("new beta account: 3 of 3 left; after 3 generations: exhausted (no purchase state)", () => {
    expect(summarisePlans([beta(0)], now)).toMatchObject({ state: "active", remaining: 3 });
    expect(summarisePlans([beta(2)], now)).toMatchObject({ state: "active", remaining: 1 });
    expect(summarisePlans([beta(3)], now)).toEqual({ state: "exhausted", allotted: 3 });
    expect(summarisePlans([], now)).toEqual({ state: "none" });
  });

  it("with a newer paid plan, that one is shown as the one being used (server charge order)", () => {
    const paid: PlanRow = { plan_type: "single", resumes_allotted: 1, resumes_used: 0, purchased_at: "2026-09-27T11:00:00Z", expires_at: "2027-09-27T11:00:00Z" };
    expect(summarisePlans([beta(0), paid], now)).toMatchObject({ state: "active", plan: { plan_type: "single" } });
  });

  it("claims only when there is no beta row, then reads again", async () => {
    const rows: PlanRow[][] = [[], [beta(0)]];
    const reads: string[] = [];
    const client = { from: (t: string) => ({ select: () => ({ eq: (_c: string, v: string) => { reads.push(`${t}:${v}`); return Promise.resolve({ data: rows.shift() ?? [], error: null }); } }) }) };
    const claimFn = jest.fn(async () => undefined);
    expect(await loadPlansEnsuringBeta(client, USER, claimFn)).toEqual([beta(0)]);
    expect(claimFn).toHaveBeenCalledTimes(1);
    expect(reads).toEqual([`user_plans:${USER}`, `user_plans:${USER}`]);

    const claim2 = jest.fn(async () => undefined);
    const has = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [beta(1)], error: null }) }) }) };
    expect(await loadPlansEnsuringBeta(has, USER, claim2)).toEqual([beta(1)]);
    expect(claim2).not.toHaveBeenCalled();
  });

  it("a failed read throws (shown as a load error, not as 'no credits')", async () => {
    const bad = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "fetch failed" } }) }) }) };
    await expect(loadPlansEnsuringBeta(bad, USER, async () => undefined)).rejects.toThrow("fetch failed");
  });
});

describe("UI: Free Beta, nothing for sale", () => {
  // In-app surfaces: nothing for sale. The landing page's pricing section and
  // /pricing show the restored paid plans with disabled "Payments coming soon"
  // buttons — covered by restored-pricing.test.ts.
  const UI = [
    "app/pricing/page.tsx", "components/beta/FreeBetaCard.tsx", "components/landing/LandingHeader.tsx",
    "app/(app)/create/page.tsx", "app/(app)/dashboard/page.tsx", "app/(app)/preview/[id]/page.tsx",
    "app/free-review/FreeReviewClient.tsx", "app/(app)/dashboard/linkedin/LinkedinRewriteClient.tsx",
  ];
  const src = Object.fromEntries(UI.map((f) => [f, read(f)]));

  it("the flag and the label", () => {
    expect(FREE_BETA).toBe(true);
    expect(FREE_BETA_LABEL).toBe("1 free AI resume preview · PDF download requires a paid credit");
    expect(FREE_BETA_FEATURES[0]).toBe("1 free AI-tailored resume preview per verified account");
    expect(BETA_EXHAUSTED_MESSAGE).toMatch(/used your 1 free AI resume preview/);
    expect(BETA_EXHAUSTED_MESSAGE).not.toMatch(/buy|upgrade|₹|plan →/i);
  });

  it.each(UI)("%s shows no ₹ price", (f) => {
    const lines = src[f].split("\n").filter((l) => l.includes("₹"));
    // The only ₹ allowed is the ATS rule hint about quantified bullets.
    expect(lines.filter((l) => !l.includes("numbers (%, ₹, counts)"))).toEqual([]);
  });

  it.each(UI)("%s has no purchase / upgrade control", (f) => {
    expect(src[f]).not.toMatch(/View plans|Buy more|Buy another|Upgrade to|Unlock (Download|your resume)|See plans|Get LinkedIn Rewrite|\/pricing#|CHEAPEST_PLAN|priceInr|\/api\/checkout/);
  });

  it("the Free Beta offer stays on the landing page and /pricing, separate from the (disabled) paid plans", () => {
    const landing = read("app/page.tsx");
    expect(landing).toMatch(/<FreeBetaCard cta=\{\{ href: "\/signup", label: "Get your free preview →" \}\} \/>/);
    expect(landing).toMatch(/1 free AI resume preview · PDF download requires a paid credit/);
    expect(read("app/pricing/PricingClient.tsx")).toMatch(/<FreeBetaCard/);
  });

  it("dashboard and create page show beta state from the server's plans (claiming first), and a spent beta says so", () => {
    for (const f of ["app/(app)/dashboard/page.tsx", "app/(app)/create/page.tsx"]) {
      expect(src[f]).toMatch(/loadPlansEnsuringBeta\(supabase/);
    }
    expect(src["app/(app)/create/page.tsx"]).toMatch(/BETA_EXHAUSTED_MESSAGE/);
    expect(src["app/(app)/dashboard/page.tsx"]).toMatch(/FREE_PREVIEW_RULE/);
  });
});

describe("accessibility: dialog close button has a name", () => {
  it("the shared DialogClose (used by the dashboard delete confirmation) is labelled", () => {
    const dialog = read("components", "ui", "dialog.tsx");
    expect(dialog).toMatch(/<DialogClose aria-label="Close"/);
    expect(dialog).toMatch(/<X className="h-4 w-4" aria-hidden="true" \/>/);
    expect(read("app", "(app)", "dashboard", "page.tsx")).toMatch(/aria-label=\{`Delete \$\{resume\.tailored_role \|\| "resume"\}`\}/);
  });
});
