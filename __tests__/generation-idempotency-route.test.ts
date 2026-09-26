/**
 * Route-level concurrency regressions for /api/generate-resume (migration 013).
 *
 * Two tabs or devices, double submits and retries must never cost two
 * credits or create two resumes for one intent — while a deliberate new
 * generation still works. The model is held open with a deferred promise so
 * requests genuinely overlap. The store is the in-memory double of the SQL
 * functions (whose own concurrency is tested against a real PostgreSQL in
 * generation-idempotency-sql.test.ts).
 */
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
const mockConsumeCredit = jest.fn<Promise<boolean>, [string]>(async () => true);
const mockCanGenerateFreeRegen = jest.fn<Promise<boolean>, [string, string, string]>(async () => false);
const mockUserOwnsResume = jest.fn<Promise<boolean>, [string, string]>(async () => true);
jest.mock("@/lib/plans", () => ({
  canGenerateResume: jest.fn(async () => ({ allowed: true })),
  canGenerateFreeRegen: (u: string, r: string, jd: string) => mockCanGenerateFreeRegen(u, r, jd),
  userOwnsResume: (u: string, r: string) => mockUserOwnsResume(u, r),
  consumeCredit: (u: string) => mockConsumeCredit(u),
}));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { createFakeGenerationStore } from "./helpers/fake-generation-store";
const mockGenerationStore = createFakeGenerationStore({ charge: (u) => mockConsumeCredit(u) });
let mockStoreBroken = false;
jest.mock("@/lib/generation-idempotency", () => ({
  ...jest.requireActual("@/lib/generation-idempotency"),
  generationStore: () =>
    mockStoreBroken
      ? { ...mockGenerationStore, begin: async () => { throw new Error('function public.begin_resume_generation does not exist'); } }
      : mockGenerationStore,
}));
import { POST } from "@/app/api/generate-resume/route";
import { generationFingerprint } from "@/lib/generation-idempotency";

const JD_A = "We are hiring a Backend Engineer to build TypeScript and Node.js services on AWS. You will design REST APIs, work with PostgreSQL and Redis at scale, and own service reliability.";
const JD_B = "We are hiring a Platform Engineer to run Kubernetes on AWS, automate CI/CD with GitHub Actions, and keep Node.js services reliable. You will own observability and on-call tooling end to end.";
const PROFILE = {
  full_name: "Priya Sharma", email: "priya@example.com", phone: "+91 98765 43210", current_city: "Bengaluru",
  target_roles: ["Backend Engineer"],
  experience: [{ company: "Acme", role: "Backend Engineer", duration: "Jun 2022 - Present", location: "Bengaluru", bullets: ["Built Node.js services on AWS."] }],
  skills: ["TypeScript", "Node.js", "AWS"],
};
const REPLY = { content: [{ type: "text", text: '{"ats_score":74,"tailored_role":"Backend Engineer","summary":"Backend Engineer building Node.js services on AWS."}' }] };

function req(over: Record<string, unknown> = {}): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_key: randomUUID(), jd_text: JD_A, template: "modern", user_profile: PROFILE, ...over }),
  }) as unknown as NextRequest;
}

/** The model call is held open until release() — so requests overlap for real. */
function holdModel() {
  const waiting: ((v: unknown) => void)[] = [];
  mockMessagesCreate.mockImplementation(() => new Promise((resolve) => waiting.push(resolve)));
  return {
    calls: () => mockMessagesCreate.mock.calls.length,
    release: () => waiting.splice(0).forEach((r) => r(REPLY)),
  };
}
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1)); expect(cond()).toBe(true); };

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerationStore.reset();
  mockStoreBroken = false;
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "someone@example.com" } } });
  mockConsumeCredit.mockResolvedValue(true);
  mockCanGenerateFreeRegen.mockResolvedValue(false);
  mockUserOwnsResume.mockResolvedValue(true);
  mockMessagesCreate.mockResolvedValue(REPLY);
});

describe("two tabs / devices at once", () => {
  it("the same request from two tabs: one generation, one charge, one resume; the other tab is told it is running", async () => {
    const model = holdModel();
    const tab1 = POST(req());
    await until(() => model.calls() === 1);
    const tab2 = await POST(req());
    expect(tab2.status).toBe(409);
    expect((await tab2.json()).error).toBe("GENERATION_IN_PROGRESS");
    model.release();
    const res1 = await tab1;
    expect(res1.status).toBe(200);
    expect(model.calls()).toBe(1);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGenerationStore.resumes).toHaveLength(1);
    expect((await res1.json()).resume_id).toBe(mockGenerationStore.resumes[0].id);
  });

  it("five tabs at once: still one of each", async () => {
    const model = holdModel();
    const first = POST(req());
    await until(() => model.calls() === 1);
    const others = await Promise.all(Array.from({ length: 4 }, () => POST(req())));
    expect(others.map((r) => r.status)).toEqual([409, 409, 409, 409]);
    model.release();
    expect((await first).status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGenerationStore.resumes).toHaveLength(1);
  });

  it("different job descriptions at the same time are both generated (not blocked)", async () => {
    const model = holdModel();
    const a = POST(req());
    const b = POST(req({ jd_text: JD_B }));
    await until(() => model.calls() === 2);
    model.release();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(2);
    expect(mockGenerationStore.resumes).toHaveLength(2);
  });
});

describe("double submits and retries", () => {
  it("the same attempt sent twice at once: one generation; a later retry replays it without charging", async () => {
    const key = randomUUID();
    const model = holdModel();
    const first = POST(req({ request_key: key }));
    await until(() => model.calls() === 1);
    expect((await POST(req({ request_key: key }))).status).toBe(409);
    model.release();
    const done = await (await first).json();

    // e.g. the response was lost and the browser retried the same attempt
    const retry = await POST(req({ request_key: key }));
    expect(retry.status).toBe(200);
    const replay = await retry.json();
    expect(replay).toMatchObject({ replayed: true, resume_id: done.resume_id });
    expect(replay.resume_json).toEqual(done.resume_json);
    expect(model.calls()).toBe(1);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGenerationStore.resumes).toHaveLength(1);
  });

  it("a deliberate new generation of the same JD after the first finishes still works", async () => {
    expect((await POST(req())).status).toBe(200);
    expect((await POST(req())).status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(2);
    expect(mockGenerationStore.resumes).toHaveLength(2);
  });

  it("a model failure charges nothing, releases the lock, and the same attempt can be retried", async () => {
    const key = randomUUID();
    mockMessagesCreate.mockRejectedValueOnce(new Error("upstream timeout"));
    const failed = await POST(req({ request_key: key }));
    expect(failed.status).toBe(500);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
    expect(mockGenerationStore.attempts[0]).toMatchObject({ status: "failed", failure: "error" });

    const retried = await POST(req({ request_key: key }));
    expect(retried.status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGenerationStore.resumes).toHaveLength(1);
  });

  it("an unparseable model reply charges nothing and releases the lock", async () => {
    mockMessagesCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "not json at all" }] });
    expect((await POST(req())).status).toBe(500);
    expect(mockGenerationStore.attempts[0]).toMatchObject({ status: "failed", failure: "parse_error" });
    expect((await POST(req())).status).toBe(200);
  });

  it("credits running out at completion: 402, nothing saved, lock released", async () => {
    mockConsumeCredit.mockResolvedValueOnce(false);
    const res = await POST(req());
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe("CREDITS_EXHAUSTED");
    expect(mockGenerationStore.resumes).toHaveLength(0);
    expect(mockGenerationStore.attempts[0]).toMatchObject({ status: "failed", failure: "credits_exhausted" });
  });

  it("a key reused for a different request is refused before the model", async () => {
    const key = randomUUID();
    expect((await POST(req({ request_key: key }))).status).toBe(200);
    const res = await POST(req({ request_key: key, jd_text: JD_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });
});

describe("rollout safety", () => {
  it("a client too old to send request_key (it would insert the row itself) is refused before anything runs", async () => {
    const body = JSON.stringify({ jd_text: JD_A, user_profile: PROFILE });
    const res = await POST(new Request("http://localhost/api/generate-resume", { method: "POST", headers: { "Content-Type": "application/json" }, body }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("CLIENT_OUTDATED");
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockGenerationStore.attempts).toHaveLength(0);
  });

  it("code deployed before the migration fails closed: 503, no model call, no charge", async () => {
    mockStoreBroken = true;
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/No credit was used/);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });
});

describe("what the server stores", () => {
  it("a free regeneration completes uncharged, with the server-verified parent", async () => {
    const parent = randomUUID();
    mockCanGenerateFreeRegen.mockResolvedValue(true);
    const res = await POST(req({ regen_of_resume_id: parent }));
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
    expect(mockGenerationStore.attempts[0].charged).toBe(false);
    expect(mockGenerationStore.resumes[0].row.regen_of_resume_id).toBe(parent);
  });

  it("an unowned parent is not stored; an unknown template is stored as NULL (the column's CHECK would reject it)", async () => {
    mockUserOwnsResume.mockResolvedValue(false);
    await POST(req({ regen_of_resume_id: randomUUID(), template: "fancy" }));
    const row = mockGenerationStore.resumes[0].row;
    expect(row.regen_of_resume_id).toBeNull();
    expect(row.template).toBeNull();
    expect(row).toMatchObject({ ats_score: 74, tailored_role: "Backend Engineer", matched_keywords: [], missing_keywords: [] });
    expect(row.contact_snapshot).toEqual({ full_name: "Priya Sharma", email: "priya@example.com", phone: "+91 98765 43210", current_city: "Bengaluru" });
  });
});

describe("generationFingerprint", () => {
  const base = { jd_text: JD_A, template: "modern", jd_keywords: ["AWS", "TypeScript"], user_profile: PROFILE, regen_of_resume_id: null };
  it("is stable under whitespace, key order and keyword order", () => {
    const fp = generationFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(generationFingerprint({ ...base, jd_text: `  ${JD_A.replace(/ /g, "  ")}\n` })).toBe(fp);
    expect(generationFingerprint({ ...base, jd_keywords: ["typescript", "aws"] })).toBe(fp);
    expect(generationFingerprint({ ...base, user_profile: Object.fromEntries(Object.entries(PROFILE).reverse()) })).toBe(fp);
  });
  it("changes with anything that changes the resume", () => {
    const fp = generationFingerprint(base);
    for (const over of [{ jd_text: JD_B }, { template: "classic" }, { jd_keywords: ["AWS"] }, { regen_of_resume_id: randomUUID() }, { user_profile: { ...PROFILE, skills: ["Go"] } }]) {
      expect(generationFingerprint({ ...base, ...over })).not.toBe(fp);
    }
  });
});
