/**
 * The REAL store (supabaseGenerationStore) — the adapter production uses to
 * call migration 013's RPCs. Route tests use an in-memory double and the SQL
 * tests call the functions directly, so without this nothing checks the seam
 * between them: an RPC or parameter name that does not match the SQL
 * signature is "function not found" in PostgREST, i.e. every generation
 * would fail with 503 in production.
 *
 * The expected names are parsed from the migration file itself.
 */
import * as fs from "fs";
import * as path from "path";

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
let nextResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const loadQuery = { table: "", filters: [] as [string, unknown][] };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return nextResult; },
    from: (table: string) => {
      loadQuery.table = table;
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { loadQuery.filters.push([col, val]); return q; },
        maybeSingle: async () => ({ data: { id: "r1", resume_json: { summary: "s" }, regen_of_resume_id: null }, error: null }),
      };
      return q;
    },
  })),
}));

import { supabaseGenerationStore, GENERATION_LEASE_SECONDS, type GeneratedResumeRow } from "@/lib/generation-idempotency";

const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "013_generation_idempotency.sql"), "utf8");
/** Parameter names of `create or replace function public.<name>(...)` in the migration. */
function sqlParams(name: string): string[] {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`, "i"));
  if (!m) throw new Error(`function ${name} not in migration`);
  return m[1].split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
}

const ROW: GeneratedResumeRow = {
  jd_text: "JD", resume_json: { summary: "s" }, ats_score: 70, tailored_role: "Engineer",
  matched_keywords: [], missing_keywords: [], contact_snapshot: { full_name: "QA", email: "qa@example.com", phone: "", current_city: "" },
  template: "classic", regen_of_resume_id: null,
};

beforeEach(() => { calls.length = 0; loadQuery.filters = []; });

it("calls each RPC by its SQL name with exactly the SQL parameter names", async () => {
  const store = supabaseGenerationStore();
  nextResult = { data: [{ outcome: "started", resume_id: null }], error: null };
  await store.begin("u", "k", "f".repeat(64));
  nextResult = { data: [{ outcome: "completed", resume_id: "r1" }], error: null };
  await store.complete("u", "k", true, ROW);
  nextResult = { data: null, error: null };
  await store.fail("u", "k", "error");

  expect(calls.map((c) => c.fn)).toEqual(["begin_resume_generation", "complete_resume_generation", "fail_resume_generation"]);
  expect(Object.keys(calls[0].args).sort()).toEqual(sqlParams("begin_resume_generation").sort());
  expect(Object.keys(calls[1].args).sort()).toEqual(sqlParams("complete_resume_generation").sort());
  expect(Object.keys(calls[2].args).sort()).toEqual(sqlParams("fail_resume_generation").sort());
  expect(calls[0].args).toMatchObject({ p_user_id: "u", p_request_key: "k", p_lease_seconds: GENERATION_LEASE_SECONDS });
  expect(calls[1].args).toMatchObject({ p_charge: true, p_resume: ROW });
});

it("the lease the route asks for is within the SQL function's accepted range and above the route's maxDuration", () => {
  expect(SQL).toMatch(/p_lease_seconds < 30 or p_lease_seconds > 900/);
  const route = fs.readFileSync(path.join(__dirname, "..", "app", "api", "generate-resume", "route.ts"), "utf8");
  const maxDuration = Number(route.match(/export const maxDuration = (\d+)/)![1]);
  expect(GENERATION_LEASE_SECONDS).toBeGreaterThanOrEqual(30);
  expect(GENERATION_LEASE_SECONDS).toBeLessThanOrEqual(900);
  expect(GENERATION_LEASE_SECONDS).toBeGreaterThan(maxDuration);
});

it.each([
  ["started", null, { outcome: "started" }],
  ["in_progress", null, { outcome: "in_progress" }],
  ["key_reused", null, { outcome: "key_reused" }],
  ["replay", "r9", { outcome: "replay", resumeId: "r9" }],
])("begin maps the PostgREST row %s", async (outcome, resume_id, expected) => {
  nextResult = { data: [{ outcome, resume_id }], error: null };
  await expect(supabaseGenerationStore().begin("u", "k", "f".repeat(64))).resolves.toEqual(expected);
});

it.each([
  ["completed", "r1", { outcome: "completed", resumeId: "r1" }],
  ["replay", "r1", { outcome: "replay", resumeId: "r1" }],
  ["payment_required", null, { outcome: "payment_required" }],
  ["expired", null, { outcome: "expired" }],
  ["unknown_request", null, { outcome: "unknown_request" }],
])("complete maps the PostgREST row %s", async (outcome, resume_id, expected) => {
  nextResult = { data: [{ outcome, resume_id }], error: null };
  await expect(supabaseGenerationStore().complete("u", "k", false, ROW)).resolves.toEqual(expected);
});

it("errors and malformed replies throw (the route turns begin() failures into 503, before any charge)", async () => {
  nextResult = { data: null, error: { message: "Could not find the function public.begin_resume_generation" } };
  await expect(supabaseGenerationStore().begin("u", "k", "f".repeat(64))).rejects.toThrow(/begin_resume_generation: Could not find/);
  nextResult = { data: [], error: null };
  await expect(supabaseGenerationStore().begin("u", "k", "f".repeat(64))).rejects.toThrow(/empty RPC result/);
  nextResult = { data: [{ outcome: "surprise", resume_id: null }], error: null };
  await expect(supabaseGenerationStore().complete("u", "k", true, ROW)).rejects.toThrow(/unexpected outcome surprise/);
});

it("load() reads the resume scoped to the caller", async () => {
  await expect(supabaseGenerationStore().load("u", "r1")).resolves.toMatchObject({ id: "r1" });
  expect(loadQuery.table).toBe("resumes");
  expect(loadQuery.filters).toEqual([["id", "r1"], ["user_id", "u"]]);
});
