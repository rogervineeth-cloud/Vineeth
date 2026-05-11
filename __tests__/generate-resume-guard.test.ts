/**
 * Guard tests for the /api/generate-resume server route.
 *
 * Asserts:
 *  - returns 402 { error: "payment_required", checkoutUrl: "/pricing" }
 *    when the caller has no entitlement.
 *  - returns 200 with the LLM-shaped payload when the caller has entitlement.
 *
 * Anthropic, Supabase, and the credit gate are mocked — this is a pure unit
 * test of the guard logic.
 */
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────
const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockMessagesCreate },
    })),
  };
});

const mockGetSession: jest.Mock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getSession: mockGetSession },
  })),
  createServiceClient: jest.fn(async () => ({})),
}));

const mockCanGenerateResume: jest.Mock = jest.fn();
const mockCanGenerateFreeRegen: jest.Mock = jest.fn(async () => false);
const mockConsumeCredit: jest.Mock = jest.fn(async () => true);
jest.mock("@/lib/plans", () => ({
  canGenerateResume: (userId: string) => mockCanGenerateResume(userId),
  canGenerateFreeRegen: (userId: string, resumeId: string) =>
    mockCanGenerateFreeRegen(userId, resumeId),
  consumeCredit: (userId: string) => mockConsumeCredit(userId),
}));

const mockTrack: jest.Mock = jest.fn();
jest.mock("@/lib/analytics", () => ({
  track: (event: string, props?: Record<string, unknown>) => mockTrack(event, props),
}));

// Route is imported AFTER the mocks above are registered.
import { POST } from "@/app/api/generate-resume/route";

const VALID_BODY = {
  jd_text:
    "We are hiring a Backend Engineer to build TypeScript and Node.js services on AWS. " +
    "You will design REST APIs, work with PostgreSQL and Redis at scale, and own service " +
    "reliability. Experience with Docker and Kafka is a plus.",
  jd_url: "",
  jd_keywords: ["typescript", "aws", "postgres"],
  template: "modern",
  user_profile: {
    full_name: "Priya Sharma",
    email: "priya@example.com",
    phone: "+91 9876543210",
    current_city: "Bengaluru",
    graduation_year: 2022,
    target_roles: ["Backend Engineer"],
    summary: "Backend engineer with 3 years of Node.js + TypeScript on AWS.",
    experience: [
      {
        company: "Acme",
        role: "Backend Engineer",
        duration: "Jun 2022 - Present",
        location: "Bengaluru",
        bullets: ["Led migration to AWS Lambda; cut infra cost 38%."],
      },
    ],
    skills: ["TypeScript", "Node.js", "AWS"],
    education: [
      { institution: "IIT Madras", degree: "B.Tech CSE", year: "2022", location: "Chennai" },
    ],
  },
};

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: a non-creator authenticated session.
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: "user-1", email: "someone@example.com" } } },
  });
});

describe("/api/generate-resume guard", () => {
  it("returns 402 with the spec'd JSON shape when the caller has no plan", async () => {
    mockCanGenerateResume.mockResolvedValue({ allowed: false, reason: "NO_PLAN" });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body).toEqual({
      error: "payment_required",
      reason: "NO_PLAN",
      checkoutUrl: "/pricing",
    });

    // The Anthropic client must NEVER be called for a blocked request.
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    // And the analytics event must fire.
    expect(mockTrack).toHaveBeenCalledWith(
      "generate_attempt_blocked_free",
      expect.objectContaining({ user_id: "user-1", reason: "NO_PLAN" })
    );
  });

  it("returns 200 and calls Anthropic when the caller has entitlement", async () => {
    mockCanGenerateResume.mockResolvedValue({ allowed: true });
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"ats_score":72,"summary":"x"}' }],
    });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.resume_json).toEqual({ ats_score: 72, summary: "x" });
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockConsumeCredit).toHaveBeenCalledWith("user-1");
    expect(mockTrack).not.toHaveBeenCalledWith(
      "generate_attempt_blocked_free",
      expect.anything()
    );
  });

  it("returns 401 when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
