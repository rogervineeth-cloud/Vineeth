/**
 * Regeneration lineage — and, since migration 018, NO FREE REGENERATION.
 *
 * Product rule (final): exactly one free AI resume per verified account;
 * every later generation, including a same-JD regeneration within 24 h,
 * needs a paid credit. The route no longer consults the old 24-hour rule.
 * The lineage wiring below (parent id carried preview → profile → create →
 * API, ownership checked server-side) is still required and still tested.
 *
 * History — free same-JD regeneration, production QA, 2026-09-23.
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

jest.mock("@/lib/plans", () => jest.requireActual("@/lib/plans")); // REAL userOwnsResume

const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })),
}));
jest.mock("@/lib/analytics", () => ({ track: jest.fn() }));

import { randomUUID } from "crypto";
import { createFakeGenerationStore } from "./helpers/fake-generation-store";
// Migrations 013 + 018 in memory: credits reserved at begin.
const mockGenerationStore = createFakeGenerationStore();
const charged = () => mockGenerationStore.charges.length;
jest.mock("@/lib/generation-idempotency", () => ({
  ...jest.requireActual("@/lib/generation-idempotency"),
  generationStore: () => mockGenerationStore,
}));
import { POST } from "@/app/api/generate-resume/route";

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER = "a0b6aa85-9768-4b40-b8d8-e80e6b57f2a3";
const OTHER_USER = "11111111-2222-4333-8444-555555555555";
const PARENT = "dc25fa97-77a6-4ceb-9761-16429dccec2c";
const JD =
  "We are hiring a Software Engineer to build TypeScript and Node.js services on AWS. " +
  "You will design REST APIs, work with PostgreSQL, and write tests. Freshers welcome. Requirements: 3+ years of professional experience, clear written communication, and ownership of production systems end to end.";
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
      request_key: randomUUID(),
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
  mockGenerationStore.reset();
  resumesTable = [];
  mockGetUser.mockResolvedValue({ data: { user: { id: USER, email: "qa.user@example.com", email_confirmed_at: "2026-09-01T00:00:00Z" } } });
  mockMessagesCreate.mockResolvedValue(reply());
});

// ── Route: a regeneration is charged like any generation ───────────────

describe("route — regeneration is never free (migration 018)", () => {
  it("the 2026-09-23 case (same JD, 2 minutes later) now spends a paid credit; lineage recorded", async () => {
    mockGenerationStore.addPlan(USER, "fresher", 5);
    resumesTable = [row(PARENT, JD, 2 * MIN)];
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.regen_of_resume_id).toBe(PARENT);
    expect(body).not.toHaveProperty("is_free_regen");
    expect(mockGenerationStore.charges).toEqual(["fresher"]);
  });

  it("no credit left: a same-JD regeneration within 24 h is refused with 402 BEFORE the AI call", async () => {
    mockGenerationStore.addPlan(USER, "single", 1).used = 1;
    resumesTable = [row(PARENT, JD, 10 * MIN)];
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect(res.status).toBe(402);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(charged()).toBe(0);
  });

  it("after the free preview, regenerating it is refused (no second free AI call)", async () => {
    mockGenerationStore.addPlan(USER, "beta", 1).used = 1;
    resumesTable = [row(PARENT, JD, 1 * MIN)];
    const res = await POST(request({ regen_of_resume_id: PARENT }));
    expect(res.status).toBe(402);
    expect((await res.json()).reason).toBe("FREE_PREVIEW_USED");
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("whitespace-identical and different JDs alike cost a credit", async () => {
    mockGenerationStore.addPlan(USER, "career", 25);
    resumesTable = [row(PARENT, `  ${JD.replace(/ /g, "  ")}\n`, 5 * MIN)];
    await POST(request({ regen_of_resume_id: PARENT }));
    resumesTable = [row(PARENT, OTHER_JD, 5 * MIN)];
    await POST(request({ regen_of_resume_id: PARENT }));
    expect(charged()).toBe(2);
  });

  it("another user's resume is ignored: charged, no lineage", async () => {
    mockGenerationStore.addPlan(USER, "career", 25);
    resumesTable = [row(PARENT, JD, 5 * MIN, null, OTHER_USER)];
    const body = await (await POST(request({ regen_of_resume_id: PARENT }))).json();
    expect(body.regen_of_resume_id).toBeNull();
    expect(charged()).toBe(1);
  });

  it("no parent id: an ordinary charged generation; 24 h later the same", async () => {
    mockGenerationStore.addPlan(USER, "career", 25);
    await POST(request());
    resumesTable = [row(PARENT, JD, 25 * HOUR)];
    await POST(request({ regen_of_resume_id: PARENT }));
    expect(charged()).toBe(2);
  });

  it("the route no longer imports or consults the old free-regeneration rule", () => {
    const route = fs.readFileSync(path.join(__dirname, "..", "app", "api", "generate-resume", "route.ts"), "utf8");
    expect(route).not.toMatch(/canGenerateFreeRegen|isFreeRegen|is_free_regen/);
    expect(fs.readFileSync(path.join(__dirname, "..", "lib", "plans.ts"), "utf8")).not.toMatch(/canGenerateFreeRegen/);
  });
});

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

  it("create: reads ?regen= from the router and sends it as regen_of_resume_id", () => {
    expect(create).toMatch(/const searchParams = useSearchParams\(\);[\s\S]*const regenParentId = parseRegenParam\(searchParams\.toString\(\)\)/);
    expect(create).toMatch(/\.\.\.\(regenParentId \? \{ regen_of_resume_id: regenParentId \} : \{\}\)/);
  });

  // Production, 2026-09-24: after a client-side <Link> to /create?regen=…,
  // window.location still held the profile URL during the first render (the
  // App Router pushes the URL in a useInsertionEffect, after render), so the
  // id read there was null and the regeneration was charged. Verified in
  // Chromium against this Next version: window read → null, useSearchParams
  // → the id. Never read the parent from window.location.
  it("create: never reads the regeneration parent from window.location", () => {
    expect(create).not.toMatch(/parseRegenParam\(window\.location/);
    expect(create).not.toMatch(/window\.location\.search\)\.get\("regen"\)/);
  });

  it("create: useSearchParams is wrapped in a Suspense boundary", () => {
    expect(create).toMatch(/<Suspense fallback=\{.*\}>\s*<CreatePageInner \/>\s*<\/Suspense>/);
  });

  it("create: a regeneration gets NO bypass of the credit gate (migration 018)", () => {
    expect(create).not.toMatch(/!planCheck\.allowed && !regenParentId/);
    expect(create).not.toMatch(/planCheck\.allowed \|\| !!regenParentId/);
    expect(create).not.toMatch(/Free regeneration/);
  });
});
