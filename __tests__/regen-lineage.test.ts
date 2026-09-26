/**
 * Regeneration lineage.
 *
 * resumes.regen_of_resume_id has existed since migration 002 but was never
 * written: the route accepted a parent id, used it for the free-regen credit
 * check, and discarded it. Confirmed in production — 0 rows carried lineage,
 * so a regeneration was indistinguishable from a fresh generation after the
 * fact.
 *
 * The client performs the INSERT, so it cannot be trusted to decide what the
 * parent is. Ownership is resolved server-side and only a verified id is
 * echoed back. These tests pin that contract at the route boundary; the
 * database-level guarantee (an RLS WITH CHECK that rejects a parent belonging
 * to another user) is in migration 012 and was verified separately against a
 * role-switched session.
 */
import { NextRequest } from "next/server";

const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })),
}));

const mockGetUser: jest.Mock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => ({})),
}));

const mockCanGenerateResume: jest.Mock = jest.fn();
const mockCanGenerateFreeRegen: jest.Mock = jest.fn();
const mockConsumeCredit: jest.Mock = jest.fn(async () => true);
const mockUserOwnsResume: jest.Mock = jest.fn();
jest.mock("@/lib/plans", () => ({
  canGenerateResume: (u: string) => mockCanGenerateResume(u),
  canGenerateFreeRegen: (u: string, r: string) => mockCanGenerateFreeRegen(u, r),
  consumeCredit: (u: string) => mockConsumeCredit(u),
  userOwnsResume: (u: string, r: string) => mockUserOwnsResume(u, r),
}));

const mockTrack: jest.Mock = jest.fn();
jest.mock("@/lib/analytics", () => ({ track: (e: string, p?: unknown) => mockTrack(e, p) }));

import { randomUUID } from "crypto";
import { createFakeGenerationStore } from "./helpers/fake-generation-store";
// Migration 013's store, in memory (same rules as the SQL functions);
// charges go through this file's credit mock.
const mockGenerationStore = createFakeGenerationStore({ charge: (u) => mockConsumeCredit(u) });
jest.mock("@/lib/generation-idempotency", () => ({
  ...jest.requireActual("@/lib/generation-idempotency"),
  generationStore: () => mockGenerationStore,
}));
import { POST } from "@/app/api/generate-resume/route";

const PARENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_USERS_RESUME = "9c858901-8a57-4791-81fe-4c455b099bc9";

const JD =
  "We are hiring a Backend Engineer to build TypeScript and Node.js services on AWS. " +
  "You will design REST APIs, work with PostgreSQL and Redis at scale, and own reliability.";

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_key: randomUUID(),
      jd_text: JD,
      template: "modern",
      user_profile: {
        full_name: "Priya Sharma",
        email: "priya@example.com",
        target_roles: ["Backend Engineer"],
        experience: [{ company: "Acme", role: "Engineer", duration: "Jun 2022 - Present", location: "Bengaluru", bullets: ["Cut cost 38%."] }],
        education: [{ institution: "IIT Madras", degree: "B.Tech", year: "2020", location: "Chennai" }],
        skills: ["TypeScript"],
      },
      ...overrides,
    }),
  }) as unknown as NextRequest;
}

const OK = {
  content: [{
    type: "text",
    text: '"summary":"S","skills":["TypeScript"],"ats_score":77,"tailored_role":"Backend Engineer","matched_keywords":[],"missing_keywords":[]}',
  }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerationStore.reset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "someone@example.com" } } });
  mockCanGenerateResume.mockResolvedValue({ allowed: true });
  mockCanGenerateFreeRegen.mockResolvedValue(false);
  mockConsumeCredit.mockResolvedValue(true);
  mockUserOwnsResume.mockResolvedValue(true);
  mockMessagesCreate.mockResolvedValue(OK);
});

describe("lineage — persistence", () => {
  it("echoes the verified parent id so the client can store it", async () => {
    const body = await (await POST(request({ regen_of_resume_id: PARENT_ID }))).json();
    expect(body.regen_of_resume_id).toBe(PARENT_ID);
  });

  it("returns null for an ordinary generation", async () => {
    const body = await (await POST(request())).json();
    expect(body.regen_of_resume_id).toBeNull();
    expect(mockUserOwnsResume).not.toHaveBeenCalled();
  });

  it("records lineage even when the free-regen window has closed", async () => {
    // A regeneration after 24h is still a regeneration. It costs a credit, but
    // the relationship is just as real and must still be recorded.
    mockCanGenerateFreeRegen.mockResolvedValue(false);
    const body = await (await POST(request({ regen_of_resume_id: PARENT_ID }))).json();
    expect(body.regen_of_resume_id).toBe(PARENT_ID);
    expect(body.is_free_regen).toBe(false);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("records lineage and charges nothing inside the free window", async () => {
    mockCanGenerateFreeRegen.mockResolvedValue(true);
    const body = await (await POST(request({ regen_of_resume_id: PARENT_ID }))).json();
    expect(body.regen_of_resume_id).toBe(PARENT_ID);
    expect(body.is_free_regen).toBe(true);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });
});

describe("lineage — ownership and security", () => {
  it("never echoes a parent the caller does not own", async () => {
    mockUserOwnsResume.mockResolvedValue(false);
    const res = await POST(request({ regen_of_resume_id: OTHER_USERS_RESUME }));
    const body = await res.json();

    // Safely ignored: the generation still succeeds, but with NO lineage, so a
    // cross-user id can never reach the column.
    expect(res.status).toBe(200);
    expect(body.regen_of_resume_id).toBeNull();
  });

  it("checks ownership against the AUTHENTICATED user, not anything client-supplied", async () => {
    await POST(request({ regen_of_resume_id: PARENT_ID }));
    expect(mockUserOwnsResume).toHaveBeenCalledWith("user-1", PARENT_ID);
  });

  it("does not grant a free regeneration on an unowned parent", async () => {
    // Otherwise naming someone else's recent resume would be a free generation.
    mockUserOwnsResume.mockResolvedValue(false);
    const body = await (await POST(request({ regen_of_resume_id: OTHER_USERS_RESUME }))).json();
    expect(body.is_free_regen).toBe(false);
    expect(mockCanGenerateFreeRegen).not.toHaveBeenCalled();
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("reports the ignored parent so abuse is visible rather than silent", async () => {
    mockUserOwnsResume.mockResolvedValue(false);
    await POST(request({ regen_of_resume_id: OTHER_USERS_RESUME }));
    expect(mockTrack).toHaveBeenCalledWith(
      "generate_resume_sanitised",
      expect.objectContaining({ warnings: "ignored_unowned_regen_parent" })
    );
  });

  it("rejects a malformed parent id before any ownership lookup or model call", async () => {
    const res = await POST(request({ regen_of_resume_id: "../../someone-elses-resume" }));
    expect(res.status).toBe(400);
    expect(mockUserOwnsResume).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("still blocks an unowned-parent request when the caller has no credits", async () => {
    // The unowned parent must not become a way around the paywall.
    mockUserOwnsResume.mockResolvedValue(false);
    mockCanGenerateResume.mockResolvedValue({ allowed: false, reason: "CREDITS_EXHAUSTED" });
    const res = await POST(request({ regen_of_resume_id: OTHER_USERS_RESUME }));
    expect(res.status).toBe(402);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
