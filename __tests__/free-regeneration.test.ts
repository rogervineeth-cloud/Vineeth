/**
 * Free same-JD regeneration — production QA, 2026-09-23.
 *
 * Resume dc25fa97 (14:02:04) → preview → "Update profile & regenerate" →
 * profile banner "Regenerating uses 1 credit (free within 24 h of the same
 * JD)" → "generate a new resume" → resume 19aa88e2 (14:04:21), identical JD.
 * Credits went 2 → 1, and 19aa88e2.regen_of_resume_id is NULL. The API logs
 * show no parent lookup at all: the id never reached the server.
 *
 *   1. profile page: the link was a bare /create — the resumeId was dropped
 *   2. create page: never sent regen_of_resume_id, and its own plan gate
 *      would block a Single-plan user (1 credit) before the server could say
 *      the regeneration is free
 *   3. server: canGenerateFreeRegen checked only the parent's age — not the
 *      JD — so wiring 1 and 2 alone would make ANY generation within 24 h of
 *      any resume free, and regenerating a regeneration would restart the
 *      window forever
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import {
  parseRegenParam,
  createHref,
  normaliseJd,
  isFreeRegen,
  FREE_REGEN_WINDOW_MS,
  MAX_LINEAGE_HOPS,
  type LineageNode,
} from "@/lib/regen";

// ── In-memory `resumes` table behind the user-scoped Supabase client ────────

type ResumeRow = { id: string; user_id: string; jd_text: string; created_at: string; regen_of_resume_id: string | null };
let resumesTable: ResumeRow[] = [];
const mockGetUser: jest.Mock = jest.fn();

function fakeUserClient() {
  return {
    auth: { getUser: mockGetUser },
    from(table: string) {
      if (table !== "resumes") throw new Error("unexpected table " + table);
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
        maybeSingle: async () => {
          const rows = resumesTable.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
          return { data: rows[0] ?? null, error: null };
        },
        single: async () => q.maybeSingle(),
      };
      return q;
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => fakeUserClient()),
  createServiceClient: jest.fn(async () => ({})),
}));

const mockCanGenerateResume: jest.Mock = jest.fn();
const mockConsumeCredit: jest.Mock = jest.fn(async () => true);
jest.mock("@/lib/plans", () => {
  const actual = jest.requireActual("@/lib/plans");
  return {
    ...actual, // REAL canGenerateFreeRegen and userOwnsResume
    canGenerateResume: (u: string) => mockCanGenerateResume(u),
    consumeCredit: (u: string) => mockConsumeCredit(u),
  };
});

const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })),
}));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { POST } from "@/app/api/generate-resume/route";
import { canGenerateFreeRegen } from "@/lib/plans";

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER = "a0b6aa85-9768-4b40-b8d8-e80e6b57f2a3";
const OTHER_USER = "11111111-2222-4333-8444-555555555555";
const PARENT = "dc25fa97-77a6-4ceb-9761-16429dccec2c";
const JD =
  "We are hiring a Software Engineer to build TypeScript and Node.js services on AWS. " +
  "You will design REST APIs, work with PostgreSQL, and write tests. Freshers welcome.";
const OTHER_JD = JD.replace("Software Engineer", "Data Analyst");
const EDU = { institution: "College of Engineering Trivandrum", degree: "B.Tech", year: "2025", location: "Kerala" };

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

function row(id: string, jd: string, createdAgoMs: number, parent: string | null = null, user = USER): ResumeRow {
  return { id, user_id: user, jd_text: jd, created_at: ago(createdAgoMs), regen_of_resume_id: parent };
}

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new Request("http://localhost/api/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jd_text: JD,
      template: "classic",
      user_profile: { full_name: "QA", email: "qa@example.com", target_roles: ["Software Engineer"], education: [EDU] },
      ...overrides,
    }),
  }) as unknown as NextRequest;
}

function reply() {
  const body = JSON.stringify({
    summary: "Software engineer.", education: [EDU], skills: [], ats_score: 60,
    matched_keywords: [], missing_keywords: [], tailored_role: "Software Engineer",
    profile_improvement_tips: [], growth_note: null,
  });
  return { content: [{ type: "text", text: body.slice(1) }] };
}

beforeEach(() => {
  jest.clearAllMocks();
  resumesTable = [];
  mockGetUser.mockResolvedValue({ data: { user: { id: USER, email: "qa.user@example.com" } } });
  mockCanGenerateResume.mockResolvedValue({ allowed: true });
  mockConsumeCredit.mockResolvedValue(true);
  mockMessagesCreate.mockResolvedValue(reply());
});

// ── Route, end to end over the real free-regen logic ──────────────────────

describe("route — same-JD regeneration is free", () => {
  it("reproduction case: same JD 2 minutes later → free, lineage recorded, no credit", async () => {
    resumesTable = [row(PARENT, JD, 2 * MIN)];
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_free_regen).toBe(true);
    expect(body.regen_of_resume_id).toBe(PARENT);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
    expect(mockCanGenerateResume).not.toHaveBeenCalled();
  });

  it("works with no credits left (Single plan = 1 credit, already spent)", async () => {
    resumesTable = [row(PARENT, JD, 10 * MIN)];
    mockCanGenerateResume.mockResolvedValue({ allowed: false, reason: "CREDITS_EXHAUSTED" });
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it("whitespace-only JD differences still count as the same JD", async () => {
    resumesTable = [row(PARENT, `  ${JD.replace(/ /g, "  ")}\n`, 5 * MIN)];
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect((await res.json()).is_free_regen).toBe(true);
  });
});

describe("route — everything else is charged", () => {
  it("a different JD costs a credit (lineage still recorded)", async () => {
    resumesTable = [row(PARENT, OTHER_JD, 5 * MIN)];
    const body = await (await POST(request({ regen_of_resume_id: PARENT }))).json();
    expect(body.is_free_regen).toBe(false);
    expect(body.regen_of_resume_id).toBe(PARENT);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("a different JD with no credits left is refused with 402 before the AI call", async () => {
    resumesTable = [row(PARENT, OTHER_JD, 5 * MIN)];
    mockCanGenerateResume.mockResolvedValue({ allowed: false, reason: "CREDITS_EXHAUSTED" });
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect(res.status).toBe(402);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it("the same JD after 24 h costs a credit", async () => {
    resumesTable = [row(PARENT, JD, 25 * HOUR)];
    await POST(request({ regen_of_resume_id: PARENT }));
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("another user's resume is ignored: charged, no lineage", async () => {
    resumesTable = [row(PARENT, JD, 5 * MIN, null, OTHER_USER)];
    const body = await (await POST(request({ regen_of_resume_id: PARENT }))).json();
    expect(body.is_free_regen).toBe(false);
    expect(body.regen_of_resume_id).toBeNull();
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });

  it("no parent id: an ordinary charged generation", async () => {
    await POST(request());
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
  });
});

// ── canGenerateFreeRegen: the lineage walk ────────────────────────────────

describe("canGenerateFreeRegen — the window is anchored to the paid original", () => {
  it("regenerating a regeneration cannot restart the window", async () => {
    // A (paid) 25h ago ← B 1h ago, same JD. The window is anchored at A, so a
    // regen from B must pay — measuring from B would restart it indefinitely.
    resumesTable = [row("a", JD, 25 * HOUR), row("b", JD, 1 * HOUR, "a")];
    await expect(canGenerateFreeRegen(USER, "b", JD)).resolves.toBe(false);
  });

  it("within 24 h of the original, a regen of a regen is still free", async () => {
    resumesTable = [row("a", JD, 3 * HOUR), row("b", JD, 1 * HOUR, "a")];
    await expect(canGenerateFreeRegen(USER, "b", JD)).resolves.toBe(true);
  });

  it("a JD change in the lineage starts a new paid original", async () => {
    // A (old JD, days ago) ← B (new JD, paid, 1h ago) → regen of B with B's JD is free.
    resumesTable = [row("a", OTHER_JD, 72 * HOUR), row("b", JD, 1 * HOUR, "a")];
    await expect(canGenerateFreeRegen(USER, "b", JD)).resolves.toBe(true);
  });

  it("an ancestor owned by someone else ends the walk (scoped to the user)", async () => {
    resumesTable = [row("a", JD, 72 * HOUR, null, OTHER_USER), row("b", JD, 1 * HOUR, "a")];
    await expect(canGenerateFreeRegen(USER, "b", JD)).resolves.toBe(true);
  });

  it("refuses when the same-JD lineage is longer than the hop limit", async () => {
    const ids = Array.from({ length: MAX_LINEAGE_HOPS + 3 }, (_, i) => `n${i}`);
    resumesTable = ids.map((id, i) => row(id, JD, 10 * MIN, ids[i + 1] ?? null));
    await expect(canGenerateFreeRegen(USER, ids[0], JD)).resolves.toBe(false);
  });

  it("a lineage exactly at the hop limit is still resolved", async () => {
    const ids = Array.from({ length: MAX_LINEAGE_HOPS + 1 }, (_, i) => `n${i}`);
    resumesTable = ids.map((id, i) => row(id, JD, 10 * MIN, ids[i + 1] ?? null));
    await expect(canGenerateFreeRegen(USER, ids[0], JD)).resolves.toBe(true);
  });

  it("unknown parent → not free", async () => {
    await expect(canGenerateFreeRegen(USER, PARENT, JD)).resolves.toBe(false);
  });
});

// ── lib/regen pure helpers ────────────────────────────────────────────────

describe("lib/regen", () => {
  const node = (jd: string, agoMs: number): LineageNode => ({ jd_text: jd, created_at: ago(agoMs) });

  it("isFreeRegen: same JD inside the window", () => {
    expect(isFreeRegen([node(JD, 2 * MIN)], JD)).toBe(true);
    expect(isFreeRegen([node(JD, FREE_REGEN_WINDOW_MS - MIN)], JD)).toBe(true);
  });

  it("isFreeRegen: outside the window, different JD, empty input", () => {
    expect(isFreeRegen([node(JD, FREE_REGEN_WINDOW_MS + MIN)], JD)).toBe(false);
    expect(isFreeRegen([node(OTHER_JD, MIN)], JD)).toBe(false);
    expect(isFreeRegen([], JD)).toBe(false);
    expect(isFreeRegen([node("", MIN)], "")).toBe(false);
    expect(isFreeRegen([{ jd_text: JD, created_at: "not a date" }], JD)).toBe(false);
  });

  it("normaliseJd ignores surrounding and repeated whitespace only", () => {
    expect(normaliseJd("  a \n\t b  ")).toBe("a b");
    expect(normaliseJd("A b")).not.toBe(normaliseJd("a b"));
    expect(normaliseJd(null)).toBe("");
  });

  it("parseRegenParam accepts only a well-formed resume id", () => {
    expect(parseRegenParam(`?regen=${PARENT}`)).toBe(PARENT);
    expect(parseRegenParam(`?step=review&regen=${PARENT.toUpperCase()}`)).toBe(PARENT);
    expect(parseRegenParam("?regen=abc")).toBeNull();
    expect(parseRegenParam("?regen=")).toBeNull();
    expect(parseRegenParam("")).toBeNull();
    expect(parseRegenParam("?regen=11111111-2222-3333-4444-555555555555")).toBeNull(); // invalid variant
  });

  it("createHref keeps a valid parent and drops anything else", () => {
    expect(createHref(PARENT)).toBe(`/create?regen=${PARENT}`);
    expect(createHref("")).toBe("/create");
    expect(createHref(null)).toBe("/create");
    expect(createHref("not-an-id")).toBe("/create");
  });
});

// ── Client wiring (no DOM harness in this repo) ───────────────────────────

describe("client wiring carries the parent from preview to the API", () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const preview = read("app", "(app)", "preview", "[id]", "page.tsx");
  const profile = read("app", "(app)", "profile", "page.tsx");
  const create = read("app", "(app)", "create", "page.tsx");

  it("preview links to the profile with its resume id", () => {
    expect(preview).toMatch(/href=\{`\/profile\?from=preview&resumeId=\$\{id\}`\}/);
  });

  it("profile: every way out to /create carries the parent", () => {
    expect(profile).toMatch(/const generateHref = createHref\(fromPreview \? fromResumeId : null\)/);
    expect(profile).toMatch(/router\.push\(generateHref\)/);
    expect((profile.match(/href=\{generateHref\}/g) ?? []).length).toBe(2);
    expect(profile).not.toMatch(/href="\/create"/);
    expect(profile).not.toMatch(/push\("\/create"\)/);
  });

  it("create: reads ?regen= and sends it as regen_of_resume_id", () => {
    expect(create).toMatch(/parseRegenParam\(window\.location\.search\)/);
    expect(create).toMatch(/\.\.\.\(regenParentId \? \{ regen_of_resume_id: regenParentId \} : \{\}\)/);
  });

  it("create: its own plan gate lets a regeneration through to the server", () => {
    expect((create.match(/!planCheck\.allowed && !regenParentId\)/g) ?? []).length).toBe(2);
    expect(create).toMatch(/planCheck\.allowed \|\| !!regenParentId\)/);
  });
});
