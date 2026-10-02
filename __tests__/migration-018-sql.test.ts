/**
 * Migration 018 (one free AI resume preview; downloads only for resumes
 * covered by a PAID credit) against a real PostgreSQL (throwaway local
 * cluster; helpers/local-postgres.ts), migrations 001-018 in order.
 * Skipped (not failed) without PostgreSQL server binaries.
 *
 * Invariants proven here:
 *   - a new account gets exactly 1 free credit; existing beta rows are capped;
 *   - credits are reserved BEFORE the model call: concurrent requests on one
 *     credit -> exactly one 'started', the rest payment_required/in_progress;
 *   - a failed attempt releases its reservation; a successful one keeps it;
 *   - the free preview credit is used FIRST, even when paid credits exist;
 *     every later generation (incl. regenerations) consumes a paid credit;
 *   - the free resume gets no download entitlement; a paid one does;
 *   - unlocking a free resume spends exactly one PAID credit, once (repeat
 *     and concurrent unlocks are free), never the free credit;
 *   - browser roles cannot call any of it or write entitlements.
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { LocalPostgres } from "./helpers/local-postgres";

const pg = LocalPostgres.create();
const d = pg ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATIONS = path.join(__dirname, "..", "supabase", "migrations");
const ROLLBACK = path.join(__dirname, "..", "supabase", "rollback", "018_free_preview_entitlement_down.sql");
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const as = (role: string, user: string, sql: string) => `set role ${role}; set request.jwt.claim.sub = '${user}'; ${sql}`;
const ROW = (jd = "jd") => JSON.stringify({ jd_text: jd, resume_json: { summary: "s" }, ats_score: 70, tailored_role: "Analyst", matched_keywords: [], missing_keywords: [], contact_snapshot: { full_name: "QA" }, template: "classic", regen_of_resume_id: null });

d("migration 018 (free preview + entitlements) on PostgreSQL", () => {
  let LEGACY_PAID_RESUME = "";
  let LEGACY_FREE_RESUME = "";
  const LEGACY = "99999999-9999-4999-8999-999999999999";
  const CAPPED = "88888888-8888-4888-8888-888888888888";

  beforeAll(() => {
    pg!.start();
    const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    // Apply up to 015, seed pre-018 data, then apply the rest (so the backfill and cap are exercised).
    for (const f of files.filter((f) => Number(f.slice(0, 3)) <= 15)) pg!.psqlFile(path.join(MIGRATIONS, f));
    pg!.psql(`insert into auth.users values ('${LEGACY}'), ('${CAPPED}')`);
    pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, purchased_at, expires_at) values
      ('${LEGACY}', 'fresher', 5, 1, now() - interval '10 days', now() + interval '1 year'),
      ('${CAPPED}', 'beta', 3, 0, now() - interval '2 days', now() + interval '1 year')`);
    LEGACY_PAID_RESUME = pg!.psql(`insert into public.resumes (user_id, jd_text, resume_json, created_at) values ('${LEGACY}', 'jd', '{}', now() - interval '5 days') returning id`);
    LEGACY_FREE_RESUME = pg!.psql(`insert into public.resumes (user_id, jd_text, resume_json, downloaded_at) values ('${CAPPED}', 'jd', '{}', now()) returning id`);
    for (const f of files.filter((f) => Number(f.slice(0, 3)) > 15)) pg!.psqlFile(path.join(MIGRATIONS, f));
  });
  afterAll(() => pg!.stop());

  const newUser = () => { const u = randomUUID(); pg!.psql(`insert into auth.users values ('${u}')`); return u; };
  const grant = (u: string) => pg!.psql(`select public.grant_beta_credits('${u}')`);
  const begin = (u: string, key: string, fp = randomUUID().replace(/-/g, "").padEnd(64, "0"), charge = true) =>
    `select outcome || '|' || coalesce(plan_type, '') from public.begin_resume_generation_v2('${u}', '${key}', '${fp}', 150, ${charge})`;
  const complete = (u: string, key: string, creator = false) =>
    pg!.psql(`select outcome || '|' || coalesce(resume_id::text, '') || '|' || entitled from public.complete_resume_generation_v2('${u}', '${key}', ${q(ROW())}::jsonb, ${creator})`).split("|");
  const fail = (u: string, key: string) => pg!.psql(`select public.fail_resume_generation_v2('${u}', '${key}', 'model error')`);
  const unlock = (u: string, resume: string) => `select outcome from public.unlock_resume_download('${u}', '${resume}')`;
  const plans = (u: string) => pg!.psql(`select coalesce(string_agg(plan_type || ':' || resumes_used || '/' || resumes_allotted, ',' order by purchased_at), '') from public.user_plans where user_id = '${u}'`);
  const entitled = (resume: string) => pg!.psql(`select count(*) from public.resume_entitlements where resume_id = '${resume}'`) === "1";
  const addPaid = (u: string, type = "single", n = 1) =>
    pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, purchased_at, expires_at) values ('${u}', '${type}', ${n}, 0, now(), now() + interval '1 year') returning id`);

  it("new accounts get exactly ONE free credit; existing beta allowances are capped to one unused", () => {
    const u = newUser();
    expect(grant(u)).toBe("t");
    expect(grant(u)).toBe("f");
    expect(plans(u)).toBe("beta:0/1");
    expect(plans(CAPPED)).toBe("beta:0/1");
  });

  it("backfill: a resume made under a paid plan stays downloadable; a free one does not (downloaded_at no longer counts)", () => {
    expect(entitled(LEGACY_PAID_RESUME)).toBe(true);
    expect(entitled(LEGACY_FREE_RESUME)).toBe(false);
  });

  it("first free generation: reserved before the model, saved WITHOUT a download entitlement", () => {
    const u = newUser(); grant(u);
    const key = randomUUID();
    expect(pg!.psql(begin(u, key))).toBe("started|beta");
    expect(plans(u)).toBe("beta:1/1"); // reserved before any model call
    const [outcome, resume, ent] = complete(u, key);
    expect([outcome, ent]).toEqual(["completed", "false"]);
    expect(entitled(resume)).toBe(false);
  });

  it("second free generation is refused before the model (payment_required), also for a regeneration", () => {
    const u = newUser(); grant(u);
    const k1 = randomUUID();
    pg!.psql(begin(u, k1));
    const [, first] = complete(u, k1);
    expect(pg!.psql(begin(u, randomUUID()))).toBe("payment_required|");
    // A same-JD regeneration is an ordinary generation now: same answer.
    expect(pg!.psql(begin(u, randomUUID(), "f".repeat(64)))).toBe("payment_required|");
    expect(plans(u)).toBe("beta:1/1");
    expect(first).toBeTruthy();
  });

  it("concurrent requests on the single free credit: exactly one model call may start", async () => {
    const u = newUser(); grant(u);
    const res = await pg!.concurrently(Array.from({ length: 8 }, () => begin(u, randomUUID())));
    const outs = res.map((r) => r.out.split("|")[0]).sort();
    expect(outs.filter((o) => o === "started")).toHaveLength(1);
    expect(outs.filter((o) => o === "payment_required")).toHaveLength(7);
    expect(plans(u)).toBe("beta:1/1");
  });

  it("a failed attempt releases its reservation (no resume, no spent credit); retrying the key works", () => {
    const u = newUser(); grant(u);
    const key = randomUUID();
    expect(pg!.psql(begin(u, key, "a".repeat(64)))).toBe("started|beta");
    fail(u, key);
    expect(plans(u)).toBe("beta:0/1");
    expect(pg!.psql(begin(u, key, "a".repeat(64)))).toBe("started|beta");
    expect(complete(u, key)[0]).toBe("completed");
    expect(plans(u)).toBe("beta:1/1");
  });

  it("an abandoned attempt's reservation comes back after its lease, on the user's next request", () => {
    const u = newUser(); grant(u);
    const key = randomUUID();
    pg!.psql(`select outcome from public.begin_resume_generation_v2('${u}', '${key}', '${"c".repeat(64)}', 30, true)`);
    pg!.psql(`update public.generation_requests set lease_expires_at = now() - interval '1 second' where request_key = '${key}'`);
    expect(pg!.psql(begin(u, randomUUID()))).toBe("started|beta");
    expect(plans(u)).toBe("beta:1/1");
    expect(complete(u, key)[0]).toBe("expired");
  });

  it("bought credits first, then generated: the FIRST generation is still the free (non-downloadable) preview; the next uses a paid credit and IS downloadable", () => {
    const u = newUser(); addPaid(u, "fresher", 5); grant(u);
    const k1 = randomUUID();
    expect(pg!.psql(begin(u, k1))).toBe("started|beta");
    const [, freeResume, freeEnt] = complete(u, k1);
    expect(freeEnt).toBe("false");
    expect(entitled(freeResume)).toBe(false);
    const k2 = randomUUID();
    expect(pg!.psql(begin(u, k2))).toBe("started|fresher");
    const [, paidResume, paidEnt] = complete(u, k2);
    expect(paidEnt).toBe("true");
    expect(entitled(paidResume)).toBe(true);
    expect(plans(u)).toBe("fresher:1/5,beta:1/1");
  });

  it("every regeneration of the same resume/JD consumes one paid credit (no free regeneration)", () => {
    const u = newUser(); grant(u); addPaid(u, "fresher", 5);
    const fp = "e".repeat(64); // the same JD every time
    const k0 = randomUUID();
    expect(pg!.psql(begin(u, k0, fp))).toBe("started|beta");
    complete(u, k0);
    for (let i = 1; i <= 3; i++) {
      const k = randomUUID();
      expect(pg!.psql(begin(u, k, fp))).toBe("started|fresher");
      expect(complete(u, k)[2]).toBe("true");
    }
    expect(plans(u)).toBe("beta:1/1,fresher:3/5");
  });

  it("concurrent first requests with free + paid credits: one runs on the free credit, the other on a paid one", async () => {
    const u = newUser(); grant(u); addPaid(u, "single", 1);
    const res = await pg!.concurrently([begin(u, randomUUID()), begin(u, randomUUID()), begin(u, randomUUID())]);
    expect(res.map((r) => r.out).sort()).toEqual(["payment_required|", "started|beta", "started|single"]);
  });

  it("a failed first attempt gives the free credit back, so the first SUCCESSFUL generation is still the free one", () => {
    const u = newUser(); addPaid(u, "single", 1); grant(u);
    const k1 = randomUUID();
    expect(pg!.psql(begin(u, k1, "1".repeat(64)))).toBe("started|beta");
    fail(u, k1);
    const k2 = randomUUID();
    expect(pg!.psql(begin(u, k2))).toBe("started|beta");
    expect(complete(u, k2)[2]).toBe("false");
    expect(plans(u)).toBe("single:0/1,beta:1/1");
  });

  it("replaying a completed attempt charges nothing more", () => {
    const u = newUser(); addPaid(u, "single", 1);
    const key = randomUUID();
    const fp = "d".repeat(64);
    pg!.psql(begin(u, key, fp));
    complete(u, key);
    expect(pg!.psql(begin(u, key, fp)).split("|")[0]).toBe("replay");
    expect(complete(u, key)[0]).toBe("replay");
    expect(plans(u)).toBe("single:1/1");
  });

  it("unlocking a free resume spends exactly one PAID credit, once; repeats and concurrent unlocks are free", async () => {
    const u = newUser(); grant(u);
    const key = randomUUID();
    pg!.psql(begin(u, key));
    const [, freeResume] = complete(u, key);
    expect(pg!.psql(unlock(u, freeResume))).toBe("payment_required"); // the free credit never unlocks
    addPaid(u, "fresher", 5);
    const res = await pg!.concurrently(Array.from({ length: 6 }, () => unlock(u, freeResume)));
    expect(res.map((r) => r.out).sort()).toEqual(["already_entitled", "already_entitled", "already_entitled", "already_entitled", "already_entitled", "unlocked"]);
    expect(pg!.psql(unlock(u, freeResume))).toBe("already_entitled");
    expect(plans(u)).toBe("beta:1/1,fresher:1/5");
    expect(entitled(freeResume)).toBe(true);
  });

  it("unlock refuses another user's resume", () => {
    const u = newUser(); addPaid(u, "single", 1);
    expect(pg!.psql(unlock(u, LEGACY_PAID_RESUME))).toBe("not_found");
    expect(plans(u)).toBe("single:0/1");
  });

  it("creator generations (no charge) are downloadable; an uncharged non-creator generation is not", () => {
    const u = newUser();
    const k1 = randomUUID();
    expect(pg!.psql(begin(u, k1, undefined, false))).toBe("started|");
    expect(complete(u, k1, true)[2]).toBe("true");
    const k2 = randomUUID();
    pg!.psql(begin(u, k2, undefined, false));
    expect(complete(u, k2, false)[2]).toBe("false");
  });

  it("browser roles cannot call the functions or write entitlements; they can read their own", () => {
    const u = newUser(); grant(u);
    for (const role of ["authenticated", "anon"]) {
      expect(() => pg!.psql(as(role, u, begin(u, randomUUID())))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, u, unlock(u, LEGACY_FREE_RESUME)))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, u, `select public.grant_beta_credits('${u}')`))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, u, `insert into public.resume_entitlements (resume_id, user_id, source) values ('${LEGACY_FREE_RESUME}', '${CAPPED}', 'unlock')`))).toThrow(/permission denied/);
    }
    expect(pg!.psql(as("authenticated", LEGACY, `select count(*) from public.resume_entitlements`))).toBe("1");
    expect(pg!.psql(as("authenticated", CAPPED, `select count(*) from public.resume_entitlements`))).toBe("0");
  });

  it("rollback removes 018 cleanly and restores the 015 grant; 018 re-applies", () => {
    pg!.psqlFile(ROLLBACK);
    expect(() => pg!.psql(begin(randomUUID(), randomUUID()))).toThrow(/does not exist/);
    const u = newUser();
    grant(u);
    expect(plans(u)).toBe("beta:0/3");
    pg!.psqlFile(path.join(MIGRATIONS, "018_free_preview_entitlement.sql"));
    expect(plans(u)).toBe("beta:0/1");
  });
});
