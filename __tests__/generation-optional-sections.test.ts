/**
 * Optional profile sections vs. the generation gate — production QA,
 * 2026-09-23.
 *
 * A paid account completed Basics, picked a role, and skipped Experience,
 * Education and Projects (each labelled optional). The create page said the
 * profile was ready; Generate returned PROFILE_INCOMPLETE.
 *
 * Two defects, one cause — the page and the server applied different rules:
 *   - The server required Education to be non-empty AND a complete experience
 *     entry or project. An experienced user who skipped Education, or a
 *     fresher with a degree and no project, was refused although the prompt
 *     is written for exactly those profiles.
 *   - Both sides counted array LENGTH. The profile page saves one blank row
 *     for a skipped Experience/Education, so the page saw content where the
 *     server (rightly) saw none.
 *
 * The rule now lives in lib/profile-completeness.ts and both sides use it:
 * each section is optional; at least one must hold a real entry.
 *
 * Every refusal must happen before the AI call and before a credit is spent.
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import {
  hasResumeContent,
  usableSections,
  isRealExperience,
  isRealEducation,
  isRealProject,
  MISSING_RESUME_CONTENT,
} from "@/lib/profile-completeness";

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
const mockConsumeCredit: jest.Mock = jest.fn(async () => true);
jest.mock("@/lib/plans", () => ({
  canGenerateResume: (u: string) => mockCanGenerateResume(u),
  canGenerateFreeRegen: async () => false,
  consumeCredit: (u: string) => mockConsumeCredit(u),
  userOwnsResume: async () => true,
}));

jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { POST } from "@/app/api/generate-resume/route";

// ── Fixtures ───────────────────────────────────────────────────────────────

// 2775-char JD in production; length only matters for the 100-char minimum.
const JD =
  "We are hiring a Software Engineer to build TypeScript and Node.js services on AWS. " +
  "You will design REST APIs, work with PostgreSQL, and write tests. Freshers welcome. " +
  "Bengaluru-based role with mentoring from senior engineers.";

// What the profile page saves for a skipped section: one blank row.
const BLANK_EXP = { company: "", role: "", duration: "", location: "", bullets: [""] };
const BLANK_EDU = { institution: "", degree: "", year: "", location: "", cgpa: "" };

const EXP = {
  company: "Acme Logistics",
  role: "Software Engineer",
  duration: "Jun 2022 - Present",
  location: "Bengaluru",
  bullets: ["Built the order-tracking API in Node.js."],
};
const EDU = { institution: "College of Engineering Trivandrum", degree: "B.Tech CSE", year: "2025", location: "Kerala", cgpa: "" };
const PROJ = { name: "Bus Tracker", description: "Live KSRTC bus locations on a map.", tech: ["React"] };

/** Basics + one target role, every optional section skipped — the QA profile. */
const MINIMAL = {
  full_name: "QA Fresher",
  email: "qa.fresher@example.com",
  phone: null,
  current_city: null,
  graduation_year: null,
  target_roles: ["Software Engineer"],
  summary: "",
  experience: [BLANK_EXP],
  skills: [],
  education: [BLANK_EDU],
  projects: [],
};

function request(user_profile: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jd_text: JD, template: "classic", jd_keywords: ["TypeScript"], user_profile }),
  }) as unknown as NextRequest;
}

/** A valid model reply (assistant turn is prefilled with "{"). */
function reply(sections: Record<string, unknown>) {
  const body = JSON.stringify({
    section_order: ["summary", "education", "projects", "skills", "experience"],
    summary: "Software engineer.",
    skills: [],
    ats_score: 55,
    matched_keywords: [],
    missing_keywords: ["TypeScript"],
    tailored_role: "Software Engineer",
    profile_improvement_tips: [],
    growth_note: null,
    ...sections,
  });
  return { content: [{ type: "text", text: body.slice(1) }] };
}

/** USER_PROFILE as the model received it. */
function profileSentToModel(): Record<string, unknown> {
  const call = mockMessagesCreate.mock.calls[0][0];
  const userMsg = call.messages.find((m: { role: string }) => m.role === "user");
  const text = typeof userMsg.content === "string" ? userMsg.content : userMsg.content[0].text;
  return JSON.parse(text).USER_PROFILE;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "paid.user@example.com" } } });
  mockCanGenerateResume.mockResolvedValue({ allowed: true });
  mockConsumeCredit.mockResolvedValue(true);
});

// ── Route ──────────────────────────────────────────────────────────────────

describe("every optional section may be empty on its own", () => {
  it("education only (fresher: experience and projects skipped) → generates", async () => {
    mockMessagesCreate.mockResolvedValueOnce(reply({ education: [EDU] }));
    const res = await POST(request({ ...MINIMAL, education: [EDU] }));
    expect(res.status).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("experience only (education and projects skipped) → generates", async () => {
    mockMessagesCreate.mockResolvedValueOnce(reply({ experience: [EXP] }));
    const res = await POST(request({ ...MINIMAL, experience: [EXP] }));
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("project only (experience and education skipped) → generates", async () => {
    mockMessagesCreate.mockResolvedValueOnce(reply({ projects: [PROJ] }));
    const res = await POST(request({ ...MINIMAL, projects: [PROJ] }));
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("empty or absent arrays are accepted when another section has content", async () => {
    mockMessagesCreate.mockResolvedValueOnce(reply({ education: [EDU] }));
    const res = await POST(
      request({ full_name: "A", email: "a@b.co", target_roles: ["Software Engineer"], education: [EDU], experience: [] })
    );
    expect(res.status).toBe(200);
  });

  it("the model is shown only real entries, never a skipped section's blank row", async () => {
    mockMessagesCreate.mockResolvedValueOnce(reply({ education: [EDU] }));
    await POST(request({ ...MINIMAL, education: [BLANK_EDU, EDU], experience: [BLANK_EXP] }));
    const sent = profileSentToModel();
    expect(sent.experience).toEqual([]);
    expect(sent.education).toEqual([EDU]);
    expect(sent.projects).toEqual([]);
  });
});

describe("refusals happen before the AI call and never consume a credit", () => {
  function expectNoChargeNoCall() {
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  }

  it("reproduction: Basics + role with every optional section skipped", async () => {
    const res = await POST(request(MINIMAL));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "PROFILE_INCOMPLETE", missing: [MISSING_RESUME_CONTENT] });
    expectNoChargeNoCall();
  });

  it("a placeholder employer is not content", async () => {
    const res = await POST(request({ ...MINIMAL, experience: [{ ...EXP, company: "Previous Organization" }] }));
    expect(res.status).toBe(422);
    expectNoChargeNoCall();
  });

  it("an experience entry with no bullets is not content", async () => {
    const res = await POST(request({ ...MINIMAL, experience: [{ ...EXP, bullets: ["  "] }] }));
    expect(res.status).toBe(422);
    expectNoChargeNoCall();
  });

  it("a project without a description is not content", async () => {
    const res = await POST(request({ ...MINIMAL, projects: [{ ...PROJ, description: " " }] }));
    expect(res.status).toBe(422);
    expectNoChargeNoCall();
  });

  it("missing name and email are reported alongside missing content", async () => {
    const res = await POST(request({ ...MINIMAL, full_name: " ", email: "" }));
    expect(res.status).toBe(422);
    expect((await res.json()).missing).toEqual(["full_name", "email", MISSING_RESUME_CONTENT]);
    expectNoChargeNoCall();
  });

  it("an AI failure after the gate still charges nothing", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error("upstream timeout"));
    const res = await POST(request({ ...MINIMAL, education: [EDU] }));
    expect(res.status).toBe(500);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });
});

// ── Shared rule ────────────────────────────────────────────────────────────

describe("lib/profile-completeness", () => {
  // Exactly the profile_data the profile page saved for the QA account.
  const SAVED_ALL_SKIPPED = {
    isFresher: false,
    expSkipped: true,
    eduSkipped: true,
    projSkipped: true,
    summary: "",
    experience: [BLANK_EXP],
    skills: [],
    education: [BLANK_EDU],
    projects: [],
  };

  it("a skipped section's blank placeholder row is not content", () => {
    expect(hasResumeContent(SAVED_ALL_SKIPPED)).toBe(false);
  });

  it.each([
    ["experience", { experience: [EXP] }],
    ["education", { education: [EDU] }],
    ["projects", { projects: [PROJ] }],
  ])("one real %s entry is enough", (_label, patch) => {
    expect(hasResumeContent({ ...SAVED_ALL_SKIPPED, ...patch })).toBe(true);
  });

  it("tolerates null, missing, and non-array sections", () => {
    expect(hasResumeContent(null)).toBe(false);
    expect(hasResumeContent({})).toBe(false);
    expect(hasResumeContent({ experience: null, education: null, projects: null })).toBe(false);
  });

  it("usableSections strips blank rows and keeps real ones in order", () => {
    const u = usableSections({ experience: [BLANK_EXP, EXP], education: [BLANK_EDU], projects: [PROJ, { name: "", description: "" }] });
    expect(u).toEqual({ experience: [EXP], education: [], projects: [PROJ] });
  });

  it("entry predicates", () => {
    expect(isRealExperience(EXP)).toBe(true);
    expect(isRealExperience({ ...EXP, company: "N/A" })).toBe(false);
    expect(isRealExperience({ ...EXP, duration: "" })).toBe(false);
    expect(isRealEducation(EDU)).toBe(true);
    expect(isRealEducation({ institution: "   " })).toBe(false);
    expect(isRealProject(PROJ)).toBe(true);
    expect(isRealProject({ name: "X", description: "" })).toBe(false);
  });
});

// The pages have no DOM harness in this repo; pin that both use the shared
// rule instead of array length, which is where the disagreement lived.
describe("pages use the shared rule", () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const create = read("app", "(app)", "create", "page.tsx");
  const profile = read("app", "(app)", "profile", "page.tsx");
  const route = read("app", "api", "generate-resume", "route.ts");

  it("create page gates Generate with hasResumeContent, not array length", () => {
    expect(create).toMatch(/if \(!hasResumeContent\(profile\.profile_data\)\)/);
    expect(create).not.toMatch(/pd\?\.experience\?\.length/);
  });

  it("create page turns PROFILE_INCOMPLETE into a readable message", () => {
    expect(create).toMatch(/data\.error === "PROFILE_INCOMPLETE"/);
    expect(create).toMatch(/No credit was used/);
  });

  it("profile checklist lists the requirement before the user leaves", () => {
    expect(profile).toMatch(/hasResumeContent\(\{ experience, education, projects \}\)/);
  });

  it("the route no longer requires education on its own", () => {
    expect(route).not.toMatch(/incomplete\.push\("education"\)/);
    expect(route).toMatch(/hasResumeContent\(usable\)/);
  });
});
