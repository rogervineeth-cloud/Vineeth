/**
 * Product rule (final): exactly ONE free AI resume generation per verified
 * account; a free-generated resume has NO PDF download; every later
 * generation (including regenerations) and every PDF download needs a paid
 * credit. Enforced server-side (migration 018; real-PostgreSQL proof in
 * migration-018-sql.test.ts). Here: /api/generate-resume end to end with the
 * store double of migration 018, plus UI copy/controls and the ATS review.
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })),
}));
const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => ({})),
}));
jest.mock("@/lib/plans", () => ({ userOwnsResume: jest.fn(async () => true) }));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { createFakeGenerationStore } from "./helpers/fake-generation-store";
const mockStore = createFakeGenerationStore();
// grant_beta_credits (migration 018): one 1-credit beta row per account, ever.
const mockEnsureBeta = jest.fn(async (userId: string) => {
  if (mockStore.plans.some((p) => p.userId === userId && p.planType === "beta")) return "existing";
  mockStore.addPlan(userId, "beta", 1);
  return "granted";
});
jest.mock("@/lib/beta", () => ({ ensureBetaCredits: (u: string) => mockEnsureBeta(u) }));
jest.mock("@/lib/generation-idempotency", () => ({
  ...jest.requireActual("@/lib/generation-idempotency"),
  generationStore: () => mockStore,
}));

import { POST } from "@/app/api/generate-resume/route";
import { FREE_PREVIEW_RULE, FREE_PREVIEW_USED_MESSAGE, VERIFY_EMAIL_FOR_FREE_MESSAGE, BETA_CREDITS, PLAN_ALLOTMENTS } from "@/lib/plan-config";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fresh@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const JD = (n = 0) => `Junior Data Analyst ${n}. Clean and analyse data in SQL and Python, build Excel and Power BI dashboards, and present findings to stakeholders. Requirements: strong SQL, attention to detail, clear written communication.`;
const PROFILE = { full_name: "Aarav Menon", email: "fresh@example.com", projects: [{ name: "Sales dashboard", description: "Built a Power BI sales dashboard.", tech: ["Power BI"] }] };
const REPLY = { content: [{ type: "text", text: '{"ats_score":70,"tailored_role":"Data Analyst","summary":"Data analyst."}' }] };
const req = (over: Record<string, unknown> = {}) => new Request("http://localhost/api/generate-resume", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ request_key: randomUUID(), jd_text: JD(), template: "classic", user_profile: PROFILE, ...over }),
}) as unknown as NextRequest;
const free = (u = USER.id) => mockStore.plans.find((p) => p.userId === u && p.planType === "beta");

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.reset();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockMessagesCreate.mockResolvedValue(REPLY);
});

describe("one free AI resume per verified account", () => {
  it("the offer is exactly 1 credit", () => {
    expect(BETA_CREDITS).toBe(1);
    expect(PLAN_ALLOTMENTS.beta).toBe(1);
    const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "018_free_preview_entitlement.sql"), "utf8");
    expect(sql).toMatch(/values \(p_user_id, 'beta', 1, 0,/);
  });

  it("first free generation succeeds — and is a free preview: no download entitlement", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ entitled: false, free_preview: true });
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(free()).toMatchObject({ used: 1, allotted: 1 });
    expect(mockStore.entitlements.size).toBe(0);
  });

  it("a second free generation is refused BEFORE any model call", async () => {
    await POST(req({ jd_text: JD(1) }));
    const res = await POST(req({ jd_text: JD(2) }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "payment_required", reason: "FREE_PREVIEW_USED", message: FREE_PREVIEW_USED_MESSAGE });
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it("concurrent free requests (different JDs, tabs, devices): exactly one model call, one resume", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => POST(req({ jd_text: JD(n) }))));
    expect(results.map((r) => r.status).sort()).toEqual([200, 402, 402, 402, 402]);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockStore.resumes).toHaveLength(1);
    expect(mockStore.started).toBe(1);
  });

  it("regenerating the free preview (same JD, minutes later) is refused — no second free AI call", async () => {
    const first = await (await POST(req())).json();
    const res = await POST(req({ regen_of_resume_id: first.resume_id }));
    expect(res.status).toBe(402);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it("a failed model call gives the free credit back (nothing saved); at most ONE successful free resume", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error("upstream timeout"));
    expect((await POST(req())).status).toBe(500);
    expect(free()).toMatchObject({ used: 0 });
    expect((await POST(req({ jd_text: JD(7) }))).status).toBe(200);
    expect((await POST(req({ jd_text: JD(8) }))).status).toBe(402);
    expect(mockStore.resumes).toHaveLength(1);
  });

  it("an unverified email gets no free credit: 402 with a verify-email message, no model call", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { ...USER, email_confirmed_at: null } } });
    const res = await POST(req());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "EMAIL_NOT_VERIFIED", message: VERIFY_EMAIL_FOR_FREE_MESSAGE });
    expect(mockEnsureBeta).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("signed out: 401, nothing granted, no model call", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req())).status).toBe(401);
    expect(mockEnsureBeta).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("forged request fields cannot buy a free download or skip the charge", async () => {
    await POST(req());
    const res = await POST(req({ jd_text: JD(3), is_creator: true, free_preview: false, entitled: true, charge: false, plan_type: "career", is_free_regen: true }));
    expect(res.status).toBe(402);
    expect(mockStore.entitlements.size).toBe(0);
  });
});

describe("paid credits", () => {
  it("credits bought BEFORE the first generation: the first is still the free preview (not downloadable), paid credits untouched", async () => {
    mockStore.addPlan(USER.id, "single", 1);
    const res = await POST(req());
    expect(await res.json()).toMatchObject({ entitled: false, free_preview: true });
    expect(mockStore.charges).toEqual(["beta"]);
    expect(mockStore.plans.find((p) => p.planType === "single")).toMatchObject({ used: 0 });
  });

  it("every later generation consumes a paid credit and is downloadable; out of credits -> 402 before the model", async () => {
    mockStore.addPlan(USER.id, "single", 1);
    expect((await (await POST(req({ jd_text: JD(1) }))).json()).free_preview).toBe(true);
    expect((await (await POST(req({ jd_text: JD(2) }))).json()).entitled).toBe(true);
    expect((await POST(req({ jd_text: JD(3) }))).status).toBe(402);
    expect(mockStore.charges).toEqual(["beta", "single"]);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it("every regeneration of the same resume/JD consumes one paid credit", async () => {
    mockStore.addPlan(USER.id, "fresher", 5);
    const first = await (await POST(req())).json();
    expect(first.free_preview).toBe(true);
    for (let i = 0; i < 3; i++) {
      const res = await POST(req({ regen_of_resume_id: first.resume_id }));
      expect(await res.json()).toMatchObject({ entitled: true, free_preview: false });
    }
    expect(mockStore.charges).toEqual(["beta", "fresher", "fresher", "fresher"]);
    expect(mockStore.plans.find((p) => p.planType === "fresher")).toMatchObject({ used: 3 });
  });

  it("the creator account is not charged and can download", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { ...USER, email: "rogervineeth@gmail.com" } } });
    expect(await (await POST(req())).json()).toMatchObject({ entitled: true, free_preview: false });
    expect(mockStore.charges).toEqual([]);
  });
});

describe("ATS review keeps its own free path and cannot reach the paid AI resume route", () => {
  // Code only (its header comment names the SDK it must not import).
  const scoreFree = fs.readFileSync(path.join(__dirname, "..", "app", "api", "score-free", "route.ts"), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  it("the score-free route makes no model call and never calls the generator", () => {
    expect(scoreFree).not.toMatch(/@anthropic-ai\/sdk|generate-resume|generationStore|ensureBetaCredits|begin_resume_generation/);
  });
  it("the free review page links to /create (which enforces credits), never posts to the generator", () => {
    const client = fs.readFileSync(path.join(__dirname, "..", "app", "free-review", "FreeReviewClient.tsx"), "utf8");
    expect(client).not.toMatch(/\/api\/generate-resume/);
  });
});

describe("UI says it plainly, everywhere, with a real next step", () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  it("the rule text", () => {
    expect(FREE_PREVIEW_RULE).toBe("Your first AI resume is a free, view-only preview. Every later Generate or Regenerate costs 1 paid credit, PDF included; 1 paid credit also unlocks the free preview's PDF.");
  });
  it("create: the rule under Generate; a free result says no PDF and links to pricing", () => {
    const create = read("app", "(app)", "create", "page.tsx");
    expect(create).toMatch(/\{!isCreator && <p className="text-xs text-center text-\[#6b6b6b\] mt-2">\{FREE_PREVIEW_RULE\}<\/p>\}/);
    expect(create).toMatch(/isFreePreview \? "View your free preview →" : "View & download PDF →"/);
    expect(create).toMatch(/\{FREE_PREVIEW_DOWNLOAD_MESSAGE\}\{" "\}\s*<Link href="\/pricing"/);
  });
  it("preview: no download button for a free preview — the message, then 'Use 1 paid credit' or a pricing link (no disabled control)", () => {
    const preview = read("app", "(app)", "preview", "[id]", "page.tsx");
    expect(preview).toMatch(/action === "unlock" \?[\s\S]*Use 1 paid credit to download[\s\S]*<Link href="\/pricing">See pricing for paid credits →<\/Link>/);
    expect(preview).not.toMatch(/resumeDownloadAllowed|downloaded_at\)/);
  });
  it("dashboard: per-resume entitlement decides Download / Unlock PDF (1 credit) / Get a paid credit; the rule is shown", () => {
    const dash = read("app", "(app)", "dashboard", "page.tsx");
    expect(dash).toMatch(/const act = downloadAction\(entitled\.has\(resume\.id\), credits\?\.paid \?\? 0\);/);
    expect(dash).toMatch(/Unlock PDF \(1 credit\)/);
    expect(dash).toMatch(/<Link href="\/pricing" aria-label=\{`Unlocking the PDF of \$\{name\} costs 1 paid credit — see pricing`\}>Get a paid credit<\/Link>/);
    expect(dash).toMatch(/Free view-only preview · 1 paid credit unlocks the PDF/);
    expect(dash).toMatch(/\{FREE_PREVIEW_RULE\}/);
  });
  it("pricing card and FAQ state the rule; no stale '3 free generations' or free-regeneration promise anywhere", () => {
    const card = read("components", "beta", "FreeBetaCard.tsx");
    expect(card).toMatch(/Unlock the preview's PDF any time with 1 paid credit/);
    expect(read("app", "page.tsx")).toMatch(/Unlocking the preview's PDF costs 1 paid credit, once/);
    for (const f of ["app/page.tsx", "app/pricing/PricingClient.tsx", "components/beta/FreeBetaCard.tsx", "app/(app)/profile/page.tsx", "app/free-review/FreeReviewClient.tsx", "app/(app)/create/page.tsx"]) {
      expect(read(f)).not.toMatch(/3 free|3 AI-tailored resume generations|free within 24 h|Free regeneration|Unlimited PDF downloads of the resumes you generate/);
    }
  });
});
