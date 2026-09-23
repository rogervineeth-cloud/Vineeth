/**
 * End-to-end contract test for the generation pipeline.
 *
 * Walks the real chain that a production request takes:
 *
 *   POST /api/generate-resume
 *     -> zod validation
 *     -> auth gate           (getUser)
 *     -> credit gate         (canGenerateResume)
 *     -> Anthropic call      (stubbed; the network call is the only stub)
 *     -> prefill-aware JSON parse
 *     -> sanitiseGeneratedResume
 *     -> consumeCredit
 *   -> the exact object app/(app)/create/page.tsx writes to public.resumes
 *   -> lib/resume-pdf.ts renderResumePdf
 *
 * The point is the seams. The client writes four columns straight off the
 * model's output:
 *
 *   ats_score, tailored_role, matched_keywords, missing_keywords
 *
 * If the model omits any of them — or the sanitiser removes the section they
 * came from — those become undefined, JSON.stringify drops them, and the row
 * lands with NULLs that the dashboard and preview then render. That is the
 * "undefined/empty corruption" class of bug, and it is invisible to a unit
 * test of any single layer.
 */
import { NextRequest } from "next/server";
import { renderResumePdf, type ResumeJson } from "@/lib/resume-pdf";

const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

const mockGetUser: jest.Mock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => ({})),
}));

const mockCanGenerateResume: jest.Mock = jest.fn();
const mockCanGenerateFreeRegen: jest.Mock = jest.fn(async () => false);
const mockConsumeCredit: jest.Mock = jest.fn(async () => true);
jest.mock("@/lib/plans", () => ({
  canGenerateResume: (u: string) => mockCanGenerateResume(u),
  canGenerateFreeRegen: (u: string, r: string) => mockCanGenerateFreeRegen(u, r),
  consumeCredit: (u: string) => mockConsumeCredit(u),
  // Parent-ownership check used by regen lineage. Stubbed as owned so the
  // free-window tests exercise credit logic, not the ownership branch.
  userOwnsResume: async () => true,
}));

jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { POST } from "@/app/api/generate-resume/route";

// ── Fixtures ───────────────────────────────────────────────────────────────

const JD =
  "We are hiring a Backend Engineer to build TypeScript and Node.js services on AWS. " +
  "You will design REST APIs, work with PostgreSQL and Redis at scale, and own service reliability. " +
  "Experience with Docker and Kafka is a plus. Bangalore-based role.";

const USER_PROFILE = {
  full_name: "Priya Sharma",
  email: "priya.sharma@example.com",
  phone: "+91 98765 43210",
  current_city: "Bengaluru",
  graduation_year: 2020,
  target_roles: ["Backend Engineer"],
  summary: "Backend engineer with 4 years of Node.js and TypeScript on AWS.",
  experience: [
    {
      company: "Acme Logistics",
      role: "Senior Backend Engineer",
      duration: "Jun 2022 - Present",
      location: "Bengaluru",
      bullets: ["Cut infrastructure cost by 38% after migrating the order pipeline."],
    },
  ],
  skills: ["TypeScript", "Node.js", "AWS", "PostgreSQL"],
  education: [
    { institution: "IIT Madras", degree: "B.Tech Computer Science", year: "2020", location: "Chennai" },
  ],
  projects: [{ name: "Report Bot", description: "Automated 120 reports.", tech: ["Python"] }],
};

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jd_text: JD,
      template: "modern",
      jd_keywords: ["TypeScript", "AWS", "PostgreSQL"],
      user_profile: USER_PROFILE,
      ...overrides,
    }),
  }) as unknown as NextRequest;
}

/**
 * A realistic model completion. The assistant turn is prefilled with "{", so a
 * real completion does NOT include the opening brace — these fixtures match
 * that shape deliberately.
 */
function completion(bodyWithoutOpeningBrace: string) {
  return { content: [{ type: "text", text: bodyWithoutOpeningBrace }] };
}

const GOOD_COMPLETION = completion(`
  "section_order": ["summary", "experience", "skills", "education", "projects"],
  "summary": "Backend Engineer with 4 years building TypeScript and Node.js services on AWS.",
  "experience": [
    {
      "company": "Acme Logistics",
      "role": "Senior Backend Engineer",
      "duration": "Jun 2022 - Present",
      "location": "Bengaluru",
      "bullets": ["Cut infrastructure cost by 38% after migrating the order pipeline to AWS Lambda."]
    }
  ],
  "skills": ["TypeScript", "Node.js", "AWS", "PostgreSQL"],
  "education": [
    { "institution": "IIT Madras", "degree": "B.Tech Computer Science", "year": "2020", "location": "Chennai" }
  ],
  "projects": [
    { "name": "Report Bot", "description": "Automated 120 reports.", "tech": ["Python"] }
  ],
  "ats_score": 78,
  "matched_keywords": ["TypeScript", "AWS", "PostgreSQL"],
  "missing_keywords": ["Kafka", "Docker"],
  "tailored_role": "Backend Engineer",
  "profile_improvement_tips": ["Add Kafka exposure."],
  "growth_note": null
}`);

/** Exactly what app/(app)/create/page.tsx writes to public.resumes. */
function clientInsertPayload(resumeJson: Record<string, unknown>, template: string) {
  return {
    user_id: "user-1",
    jd_text: JD,
    resume_json: resumeJson,
    ats_score: resumeJson.ats_score,
    tailored_role: resumeJson.tailored_role,
    matched_keywords: resumeJson.matched_keywords,
    missing_keywords: resumeJson.missing_keywords,
    contact_snapshot: {
      full_name: USER_PROFILE.full_name,
      email: USER_PROFILE.email,
      phone: USER_PROFILE.phone,
      current_city: USER_PROFILE.current_city,
    },
    template,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "someone@example.com" } } });
  mockCanGenerateResume.mockResolvedValue({ allowed: true });
  mockCanGenerateFreeRegen.mockResolvedValue(false);
  mockConsumeCredit.mockResolvedValue(true);
});

describe("generation pipeline — happy path", () => {
  it("returns a resume and consumes exactly one credit", async () => {
    mockMessagesCreate.mockResolvedValue(GOOD_COMPLETION);
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.resume_json.tailored_role).toBe("Backend Engineer");
    expect(body.resume_json.ats_score).toBe(78);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockConsumeCredit).toHaveBeenCalledWith("user-1");
  });

  it("every column the client writes is defined — no NULL corruption", async () => {
    mockMessagesCreate.mockResolvedValue(GOOD_COMPLETION);
    const body = await (await POST(request())).json();
    const row = clientInsertPayload(body.resume_json, "modern");

    for (const key of ["ats_score", "tailored_role", "matched_keywords", "missing_keywords"] as const) {
      expect({ key, value: row[key] }).not.toEqual({ key, value: undefined });
    }
    expect(typeof row.ats_score).toBe("number");
    expect(Array.isArray(row.matched_keywords)).toBe(true);
    expect(Array.isArray(row.missing_keywords)).toBe(true);
  });

  it("renders a PDF containing no literal undefined/null/NaN", async () => {
    mockMessagesCreate.mockResolvedValue(GOOD_COMPLETION);
    const body = await (await POST(request())).json();

    const bytes = await renderResumePdf(
      body.resume_json as ResumeJson,
      { full_name: "Priya Sharma", email: "priya.sharma@example.com", phone: "+91 98765 43210", current_city: "Bengaluru" },
      "modern"
    );
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    // pdf-lib writes drawn strings into the content stream in the clear, so a
    // stringified undefined would be visible here.
    const raw = Buffer.from(bytes).toString("latin1");
    for (const bad of ["undefined", "NaN", "[object Object]"]) {
      expect({ bad, present: raw.includes(bad) }).toEqual({ bad, present: false });
    }
  });
});

describe("generation pipeline — model omits fields", () => {
  it("refuses to save, and charges nothing, when ats_score is missing", async () => {
    // There is no honest default for a score, and a NULL ats_score renders as
    // a red "0" on the dashboard and an empty dial in the preview. Failing
    // costs the user a retry; saving costs them a credit and their trust.
    mockMessagesCreate.mockResolvedValue(
      completion(`"summary": "A summary.", "experience": [], "skills": ["TypeScript"], "education": []}`)
    );
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', '""'],
    ['whitespace only', '"   "'],
  ])("refuses to save, and charges nothing, when ats_score is %s", async (_label, literal) => {
    // Number("") and Number("   ") are both a finite 0, so without an explicit
    // blank check these would be stored as a genuine score of zero.
    mockMessagesCreate.mockResolvedValue(
      completion(`"summary": "A summary.", "tailored_role": "Backend Engineer", "ats_score": ${literal}}`)
    );
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it("repairs the fields that CAN be defaulted honestly and still succeeds", async () => {
    // Labels and lists assert nothing about the candidate, so an empty value
    // is safe. Only the score is fatal.
    mockMessagesCreate.mockResolvedValue(
      completion(`"summary": "A summary.", "skills": ["TypeScript"], "ats_score": 71}`)
    );
    const res = await POST(request());
    expect(res.status).toBe(200);
    const row = clientInsertPayload((await res.json()).resume_json, "classic");

    for (const key of ["ats_score", "tailored_role", "matched_keywords", "missing_keywords"] as const) {
      expect({ key, value: row[key] }).not.toEqual({ key, value: undefined });
    }
    expect(row.matched_keywords).toEqual([]);
    expect(row.missing_keywords).toEqual([]);
    // Falls back to the user's own target role rather than inventing one.
    expect(row.tailored_role).toBe("Backend Engineer");
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid numeric-string score", async () => {
    mockMessagesCreate.mockResolvedValue(
      completion(`"summary": "A summary.", "ats_score": "78", "tailored_role": "Backend Engineer"}`)
    );
    const body = await (await POST(request())).json();
    expect(body.resume_json.ats_score).toBe(78);
    expect(typeof body.resume_json.ats_score).toBe("number");
  });

  it.each([
    ["number above the ceiling", "142"],
    ["number just above the ceiling", "101"],
    ["negative number", "-5"],
    ['string above the ceiling', '"142"'],
    ['negative string', '"-5"'],
  ])(
    "refuses to save, and charges nothing, for an out-of-range score (%s)",
    async (_label, literal) => {
      // Out-of-range is a contract violation, not something to clamp: 142 -> 100
      // would manufacture a perfect result and -5 -> 0 would show a red zero.
      mockMessagesCreate.mockResolvedValue(
        completion(`"summary": "A summary.", "tailored_role": "Backend Engineer", "ats_score": ${literal}}`)
      );
      const res = await POST(request());
      expect(res.status).toBe(500);
      expect(mockConsumeCredit).not.toHaveBeenCalled();
    }
  );
});

describe("generation pipeline — fabrication is stripped before storage", () => {
  it("removes invented companies and metrics from what gets saved", async () => {
    mockMessagesCreate.mockResolvedValue(
      completion(`
        "section_order": ["summary", "experience", "skills", "education"],
        "summary": "Backend Engineer.",
        "experience": [
          {
            "company": "Previous Organization",
            "role": "Senior Sales Executive",
            "duration": "2019 - 2021",
            "location": "",
            "bullets": ["Drove Rs.8.5 Cr in annual partner revenue."]
          },
          {
            "company": "Acme Logistics",
            "role": "Senior Backend Engineer",
            "duration": "Jun 2022 - Present",
            "location": "Bengaluru",
            "bullets": [
              "Cut infrastructure cost by 38% after migrating the order pipeline.",
              "Improved close rates by 28% while holding 94% satisfaction."
            ]
          }
        ],
        "skills": ["TypeScript"],
        "education": [
          { "institution": "Institution Name", "degree": "Bachelor's Degree", "year": "2018", "location": "" },
          { "institution": "IIT Madras", "degree": "B.Tech Computer Science", "year": "2020", "location": "Chennai" }
        ],
        "ats_score": 91,
        "matched_keywords": ["TypeScript"],
        "missing_keywords": ["Kafka"],
        "tailored_role": "Backend Engineer"
      }`)
    );

    const body = await (await POST(request())).json();
    const saved = JSON.stringify(body.resume_json);

    expect(saved).not.toContain("Previous Organization");
    expect(saved).not.toContain("Institution Name");
    expect(saved).not.toContain("8.5");
    expect(saved).not.toContain("28%");
    expect(saved).not.toContain("94%");
    // The grounded bullet and the real school survive.
    expect(saved).toContain("38%");
    expect(saved).toContain("IIT Madras");
  });
});

describe("generation pipeline — failure modes", () => {
  it("does not consume a credit when the model returns unparseable output", async () => {
    mockMessagesCreate.mockResolvedValue(completion("I'm sorry, I cannot help with that."));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it("does not call the model at all when the caller has no credits", async () => {
    mockCanGenerateResume.mockResolvedValue({ allowed: false, reason: "CREDITS_EXHAUSTED" });
    const res = await POST(request());
    expect(res.status).toBe(402);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });
});

describe("generation pipeline — free regeneration lineage", () => {
  // A real RFC-4122 v4 UUID. An earlier fixture used 1111...-4444-5555... which
  // zod rejects on the variant nibble — worth noting, because that rejection is
  // correct behaviour and is asserted separately below.
  const REGEN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("does not consume a credit for a regen inside the free window", async () => {
    mockCanGenerateFreeRegen.mockResolvedValue(true);
    mockMessagesCreate.mockResolvedValue(GOOD_COMPLETION);

    const res = await POST(request({ regen_of_resume_id: REGEN_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.is_free_regen).toBe(true);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
    // Lineage is checked against the ORIGINAL resume, owned by this user.
    expect(mockCanGenerateFreeRegen).toHaveBeenCalledWith("user-1", REGEN_ID);
  });

  it("falls back to consuming a credit once the free window has closed", async () => {
    mockCanGenerateFreeRegen.mockResolvedValue(false);
    mockMessagesCreate.mockResolvedValue(GOOD_COMPLETION);

    const res = await POST(request({ regen_of_resume_id: REGEN_ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).is_free_regen).toBe(false);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("rejects a regen id that is not a uuid rather than trusting it", async () => {
    const res = await POST(request({ regen_of_resume_id: "../../someone-elses-resume" }));
    expect(res.status).toBe(400);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
