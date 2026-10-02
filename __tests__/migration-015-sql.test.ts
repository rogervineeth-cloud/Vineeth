/**
 * Migration 015 (Free Beta: 3 resume generations per account) against a real
 * PostgreSQL (throwaway local cluster; see helpers/local-postgres.ts),
 * migrations 001-015 in order.
 *
 * Skipped (not failed) on machines without PostgreSQL server binaries.
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { LocalPostgres } from "./helpers/local-postgres";

const pg = LocalPostgres.create();
const d = pg ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATIONS = path.join(__dirname, "..", "supabase", "migrations");
const ROLLBACK = path.join(__dirname, "..", "supabase", "rollback", "015_free_beta_credits_down.sql");
const NEW = "11111111-1111-4111-8111-111111111111";
const RACE = "22222222-2222-4222-8222-222222222222";
const PAID = "33333333-3333-4333-8333-333333333333";
const HACKER = "44444444-4444-4444-8444-444444444444";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const as = (role: string, user: string, sql: string) => `set role ${role}; set request.jwt.claim.sub = '${user}'; ${sql}`;
const grant = (u: string) => `select public.grant_beta_credits('${u}')`;
const row = (jd: string) => JSON.stringify({ jd_text: jd, resume_json: { summary: "x" }, ats_score: 70, tailored_role: "Analyst",
  matched_keywords: [], missing_keywords: [], contact_snapshot: { full_name: "QA" }, template: "classic", regen_of_resume_id: null });

d("migration 015 (Free Beta credits) on PostgreSQL", () => {
  beforeAll(() => {
    pg!.start();
    // 001-015 only: this suite is 015 as written (3 credits). Migration 018
    // changes the grant to 1 credit (see migration-018-sql.test.ts).
    for (const f of fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= 15).sort()) pg!.psqlFile(path.join(MIGRATIONS, f));
    pg!.psql(`insert into auth.users values ('${NEW}'), ('${RACE}'), ('${PAID}'), ('${HACKER}')`);
  });
  afterAll(() => pg!.stop());

  const plans = (u: string) => pg!.psql(`select coalesce(string_agg(plan_type || ':' || coalesce(resumes_used, 0) || '/' || resumes_allotted, ',' order by purchased_at), '') from public.user_plans where user_id = '${u}'`);
  /** One generation through 013's functions, as the route does it (charged). */
  const generate = (u: string, jd = `JD ${randomUUID()}`) => {
    const key = randomUUID();
    const fp = randomUUID().replace(/-/g, "").padEnd(64, "0");
    expect(pg!.psql(`select outcome from public.begin_resume_generation('${u}', '${key}', '${fp}', 150)`)).toBe("started");
    return pg!.psql(`select outcome from public.complete_resume_generation('${u}', '${key}', true, ${q(row(jd))}::jsonb)`);
  };

  it("a new account gets exactly one 3-credit beta plan; repeated grants change nothing", () => {
    expect(plans(NEW)).toBe("");
    expect(pg!.psql(grant(NEW))).toBe("t");
    expect(pg!.psql(grant(NEW))).toBe("f");
    expect(pg!.psql(grant(NEW))).toBe("f");
    expect(plans(NEW)).toBe("beta:0/3");
    expect(pg!.psql(`select is_test::text || '|' || (expires_at > now() + interval '364 days')::text from public.user_plans where user_id = '${NEW}'`)).toBe("false|true");
  });

  it("8 simultaneous grants (tabs, retries) create one row", async () => {
    const results = await pg!.concurrently(Array.from({ length: 8 }, () => grant(RACE)));
    expect(results.every((r) => r.code === 0)).toBe(true);
    expect(results.map((r) => r.out).filter((o) => o === "t")).toHaveLength(1);
    expect(plans(RACE)).toBe("beta:0/3");
  });

  it("the 3 credits are charged by generation; the 4th generation is refused (payment_required), nothing saved", () => {
    expect([generate(NEW), generate(NEW), generate(NEW)]).toEqual(["completed", "completed", "completed"]);
    expect(plans(NEW)).toBe("beta:3/3");
    expect(generate(NEW)).toBe("payment_required");
    expect(Number(pg!.psql(`select count(*) from public.resumes where user_id = '${NEW}'`))).toBe(3);
  });

  it("spent credits cannot be reclaimed by granting again", () => {
    expect(pg!.psql(grant(NEW))).toBe("f");
    expect(plans(NEW)).toBe("beta:3/3");
  });

  it("the browser role cannot grant, reset, add, or delete credits", () => {
    pg!.psql(grant(HACKER));
    for (const role of ["authenticated", "anon"]) {
      expect(() => pg!.psql(as(role, HACKER, grant(HACKER)))).toThrow(/permission denied/);
    }
    const before = plans(HACKER);
    for (const sql of [
      `update public.user_plans set resumes_used = 0 where user_id = '${HACKER}'`,
      `delete from public.user_plans where user_id = '${HACKER}'`,
    ]) {
      pg!.psql(as("authenticated", HACKER, sql)); // RLS: no UPDATE/DELETE policy — matches no rows
    }
    expect(() => pg!.psql(as("authenticated", HACKER,
      `insert into public.user_plans (user_id, plan_type, resumes_allotted, expires_at) values ('${HACKER}', 'beta', 99, now() + interval '1 year')`)))
      .toThrow(/row-level security|permission denied/);
    expect(plans(HACKER)).toBe(before);
    // Even the server cannot create a second beta row for the same account.
    expect(() => pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, expires_at) values ('${HACKER}', 'beta', 3, now() + interval '1 year')`))
      .toThrow(/duplicate key/);
  });

  it("coexists with a paid plan: the newer paid plan is charged first, then the beta credits", () => {
    pg!.psql(grant(PAID));
    pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, purchased_at, expires_at)
              values ('${PAID}', 'single', 1, 0, now() + interval '1 second', now() + interval '1 year')`);
    expect(generate(PAID)).toBe("completed");
    expect(plans(PAID)).toBe("beta:0/3,single:1/1");
    expect(generate(PAID)).toBe("completed");
    expect(plans(PAID)).toBe("beta:1/3,single:1/1");
  });

  it("the plan_type check still rejects unknown types", () => {
    expect(() => pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, expires_at) values ('${PAID}', 'unlimited', 999, now() + interval '1 year')`))
      .toThrow(/user_plans_plan_type_check/);
  });

  it("rollback stops new grants but keeps every granted/spent beta row; 015 re-applies cleanly", () => {
    const before = pg!.psql(`select count(*) from public.user_plans where plan_type = 'beta'`);
    pg!.psqlFile(ROLLBACK);
    expect(() => pg!.psql(grant(randomUUID()))).toThrow(/does not exist/);
    expect(pg!.psql(`select count(*) from public.user_plans where plan_type = 'beta'`)).toBe(before);
    pg!.psqlFile(path.join(MIGRATIONS, "015_free_beta_credits.sql"));
    expect(pg!.psql(grant(NEW))).toBe("f");
  });
});
