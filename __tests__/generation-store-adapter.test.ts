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

// The adapter calls migration 018's _v2 functions (credits reserved at begin).
const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "018_free_preview_entitlement.sql"), "utf8");
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
  nextResult = { data: [{ outcome: "started", resume_id: null, plan_type: "beta" }], error: null };
  await store.begin("u", "k", "f".repeat(64), true);
  nextResult = { data: [{ outcome: "completed", resume_id: "r1", entitled: false }], error: null };
  await store.complete("u", "k", ROW, false);
  nextResult = { data: null, error: null };
  await store.fail("u", "k", "error");

  expect(calls.map((c) => c.fn)).toEqual(["begin_resume_generation_v2", "complete_resume_generation_v2", "fail_resume_generation_v2"]);
  expect(Object.keys(calls[0].args).sort()).toEqual(sqlParams("begin_resume_generation_v2").sort());
  expect(Object.keys(calls[1].args).sort()).toEqual(sqlParams("complete_resume_generation_v2").sort());
  expect(Object.keys(calls[2].args).sort()).toEqual(sqlParams("fail_resume_generation_v2").sort());
  expect(calls[0].args).toMatchObject({ p_user_id: "u", p_request_key: "k", p_lease_seconds: GENERATION_LEASE_SECONDS, p_charge: true });
  expect(calls[1].args).toMatchObject({ p_resume: ROW, p_is_creator: false });
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
  ["started", null, { plan_type: "beta" }, { outcome: "started", planType: "beta" }],
  ["started", null, { plan_type: null }, { outcome: "started", planType: null }],
  ["in_progress", null, {}, { outcome: "in_progress" }],
  ["key_reused", null, {}, { outcome: "key_reused" }],
  ["payment_required", null, {}, { outcome: "payment_required" }],
  ["replay", "r9", {}, { outcome: "replay", resumeId: "r9" }],
])("begin maps the PostgREST row %s", async (outcome, resume_id, extra, expected) => {
  nextResult = { data: [{ outcome, resume_id, ...extra }], error: null };
  await expect(supabaseGenerationStore().begin("u", "k", "f".repeat(64), true)).resolves.toEqual(expected);
});

it.each([
  ["completed", "r1", true, { outcome: "completed", resumeId: "r1", entitled: true }],
  ["completed", "r1", false, { outcome: "completed", resumeId: "r1", entitled: false }],
  ["replay", "r1", false, { outcome: "replay", resumeId: "r1", entitled: false }],
  ["expired", null, false, { outcome: "expired" }],
  ["unknown_request", null, false, { outcome: "unknown_request" }],
])("complete maps the PostgREST row %s (entitled=%s)", async (outcome, resume_id, entitled, expected) => {
  nextResult = { data: [{ outcome, resume_id, entitled }], error: null };
  await expect(supabaseGenerationStore().complete("u", "k", ROW, false)).resolves.toEqual(expected);
});

it("errors and malformed replies throw (the route turns begin() failures into 503, before any charge)", async () => {
  nextResult = { data: null, error: { message: "Could not find the function public.begin_resume_generation_v2" } };
  await expect(supabaseGenerationStore().begin("u", "k", "f".repeat(64), true)).rejects.toThrow(/begin_resume_generation_v2: Could not find/);
  nextResult = { data: [], error: null };
  await expect(supabaseGenerationStore().begin("u", "k", "f".repeat(64), true)).rejects.toThrow(/empty RPC result/);
  nextResult = { data: [{ outcome: "surprise", resume_id: null }], error: null };
  await expect(supabaseGenerationStore().complete("u", "k", ROW, false)).rejects.toThrow(/unexpected outcome surprise/);
});

it("load() reads the resume scoped to the caller, then its download entitlement", async () => {
  await expect(supabaseGenerationStore().load("u", "r1")).resolves.toMatchObject({ id: "r1", entitled: true });
  expect(loadQuery.table).toBe("resume_entitlements");
  expect(loadQuery.filters).toEqual([["id", "r1"], ["user_id", "u"], ["resume_id", "r1"]]);
});
