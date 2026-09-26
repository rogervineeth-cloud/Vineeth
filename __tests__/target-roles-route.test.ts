/**
 * /api/generate-resume never tailors to the role picker's "Other" sentinel,
 * even when a stale client or an old stored profile still sends it.
 * Anthropic, Supabase and the credit gate are mocked, as in
 * generate-resume-guard.test.ts.
 */
import { NextRequest } from "next/server";

const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: "user-1", email: "someone@example.com" } } })) },
  })),
  createServiceClient: jest.fn(async () => ({})),
}));
jest.mock("@/lib/plans", () => ({
  canGenerateResume: jest.fn(async () => ({ allowed: true })),
  canGenerateFreeRegen: jest.fn(async () => false),
  consumeCredit: jest.fn(async () => true),
  userOwnsResume: jest.fn(async () => false),
}));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { POST } from "@/app/api/generate-resume/route";

const JD =
  "We are hiring a Backend Engineer to build TypeScript and Node.js services on AWS. " +
  "You will design REST APIs, work with PostgreSQL and Redis at scale, and own service " +
  "reliability. Experience with Docker and Kafka is a plus.";

function request(targetRoles: string[]): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jd_text: JD,
      user_profile: {
        full_name: "Priya Sharma",
        email: "priya@example.com",
        target_roles: targetRoles,
        experience: [{ company: "Acme", role: "Backend Engineer", duration: "Jun 2022 - Present", location: "Bengaluru", bullets: ["Built Node.js services on AWS."] }],
        skills: ["TypeScript", "Node.js", "AWS"],
      },
    }),
  }) as unknown as NextRequest;
}

/** The user turn(s) sent to the model — the system prompt is excluded. */
function userTurns(): string {
  const arg = mockMessagesCreate.mock.calls[0][0];
  return JSON.stringify(arg.messages);
}

beforeEach(() => {
  jest.clearAllMocks();
  // No tailored_role: the server falls back to the first target role.
  mockMessagesCreate.mockResolvedValue({ content: [{ type: "text", text: '{"ats_score":70,"summary":"Backend Engineer building Node.js services on AWS."}' }] });
});

it("a profile whose only role is 'Other' is not tailored to 'Other'", async () => {
  const res = await POST(request(["Other"]));
  expect(res.status).toBe(200);
  expect(userTurns()).not.toMatch(/\bOther\b/);
  const body = await res.json();
  expect(body.resume_json.tailored_role).not.toBe("Other");
});

it("'Other' is dropped and the real role is used", async () => {
  const res = await POST(request(["other", "Data Analyst"]));
  expect(res.status).toBe(200);
  expect(userTurns()).not.toMatch(/\bother\b/i);
  expect(userTurns()).toMatch(/Data Analyst/);
  expect((await res.json()).resume_json.tailored_role).toBe("Data Analyst");
});
