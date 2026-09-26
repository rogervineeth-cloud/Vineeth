/**
 * Migration 013 against a real PostgreSQL (throwaway local cluster; see
 * helpers/local-postgres.ts). Every migration 001-013 is applied in order,
 * then the idempotency functions are exercised — including truly concurrent
 * calls, each on its own connection, as two tabs or devices would make them.
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
const ROLLBACK = path.join(__dirname, "..", "supabase", "rollback", "013_generation_idempotency_down.sql");
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const fp = (n: number) => n.toString(16).padStart(64, "0");

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const beginSql = (user: string, key: string, fingerprint: string, lease = 150) =>
  `select outcome || '|' || coalesce(resume_id::text, '') from public.begin_resume_generation(${q(user)}, ${q(key)}, ${q(fingerprint)}, ${lease})`;
const resumeJson = (over: Record<string, unknown> = {}) => JSON.stringify({
  jd_text: "Backend Engineer JD", resume_json: { summary: "x", ats_score: 71.6 }, ats_score: 71.6,
  tailored_role: "Backend Engineer", matched_keywords: ["AWS"], missing_keywords: ["Kafka"],
  contact_snapshot: { full_name: "Priya" }, template: "modern", regen_of_resume_id: null, ...over,
});
const completeSql = (user: string, key: string, charge: boolean, row = resumeJson()) =>
  `select outcome || '|' || coalesce(resume_id::text, '') from public.complete_resume_generation(${q(user)}, ${q(key)}, ${charge}, ${q(row)}::jsonb)`;

d("migration 013 on PostgreSQL", () => {
  beforeAll(() => {
    pg!.start();
    for (const f of fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) pg!.psqlFile(path.join(MIGRATIONS, f));
    pg!.psql(`insert into auth.users values ('${U1}'), ('${U2}'), ('${U3}')`);
    pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, expires_at)
              values ('${U1}', 'job_hunter', 10, 0, now() + interval '30 days'),
                     ('${U2}', 'fresher', 2, 0, now() + interval '30 days'),
                     ('${U3}', 'single', 1, 0, now() + interval '30 days')`);
  });
  afterAll(() => pg!.stop());

  const used = (u: string) => Number(pg!.psql(`select coalesce(sum(resumes_used), 0) from public.user_plans where user_id = '${u}'`));
  const resumes = (u: string) => Number(pg!.psql(`select count(*) from public.resumes where user_id = '${u}'`));

  it("simultaneous identical requests from 8 tabs: exactly one starts", async () => {
    const results = await pg!.concurrently(Array.from({ length: 8 }, () => beginSql(U1, randomUUID(), fp(1))));
    expect(results.every((r) => r.code === 0)).toBe(true);
    const outcomes = results.map((r) => r.out.split("|")[0]).sort();
    expect(outcomes.filter((o) => o === "started")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "in_progress")).toHaveLength(7);
  });

  it("the same request completed 6 times at once: one charge, one resume, the rest replay it", async () => {
    const key = randomUUID();
    pg!.psql(`update public.generation_requests set status = 'failed' where user_id = '${U1}' and status = 'pending'`);
    expect(pg!.psql(beginSql(U1, key, fp(2)))).toBe("started|");
    const before = used(U1);
    const results = await pg!.concurrently(Array.from({ length: 6 }, () => completeSql(U1, key, true)));
    const rows = results.map((r) => r.out.split("|"));
    expect(rows.filter(([o]) => o === "completed")).toHaveLength(1);
    expect(rows.filter(([o]) => o === "replay")).toHaveLength(5);
    expect(new Set(rows.map(([, id]) => id)).size).toBe(1);
    expect(used(U1)).toBe(before + 1);
    expect(Number(pg!.psql(`select count(*) from public.resumes where generation_request_id is not null and user_id = '${U1}'`))).toBe(1);
    // The row is what the route asked for.
    expect(pg!.psql(`select ats_score || '|' || tailored_role || '|' || template || '|' || array_to_string(matched_keywords, ',') from public.resumes where id = '${rows[0][1]}'`))
      .toBe("72|Backend Engineer|modern|AWS");
    // A later retry of the same attempt gets the same resume, uncharged.
    expect(pg!.psql(beginSql(U1, key, fp(2)))).toBe(`replay|${rows[0][1]}`);
    expect(used(U1)).toBe(before + 1);
  });

  it("after it finishes, a new generation of the same JD is allowed (not blocked)", () => {
    const key = randomUUID();
    expect(pg!.psql(beginSql(U1, key, fp(2)))).toBe("started|");
    expect(pg!.psql(completeSql(U1, key, true))).toMatch(/^completed\|[0-9a-f-]{36}$/);
  });

  it("a failed attempt releases the lock and can be retried under the same key", () => {
    const key = randomUUID();
    expect(pg!.psql(beginSql(U1, key, fp(3)))).toBe("started|");
    expect(pg!.psql(beginSql(U1, randomUUID(), fp(3)))).toBe("in_progress|");
    pg!.psql(`select public.fail_resume_generation('${U1}', '${key}', 'model_error')`);
    const before = used(U1);
    expect(pg!.psql(beginSql(U1, key, fp(3)))).toBe("started|");
    expect(used(U1)).toBe(before);
  });

  it("a key reused for a different request is refused", () => {
    const key = randomUUID();
    pg!.psql(beginSql(U1, key, fp(4)));
    expect(pg!.psql(beginSql(U1, key, fp(5)))).toBe("key_reused|");
  });

  it("no overdraft: 5 different generations completing at once on 2 credits charge exactly 2", async () => {
    const keys = Array.from({ length: 5 }, () => randomUUID());
    keys.forEach((k, i) => expect(pg!.psql(beginSql(U2, k, fp(100 + i)))).toBe("started|"));
    const results = await pg!.concurrently(keys.map((k) => completeSql(U2, k, true)));
    const outcomes = results.map((r) => r.out.split("|")[0]);
    expect(outcomes.filter((o) => o === "completed")).toHaveLength(2);
    expect(outcomes.filter((o) => o === "payment_required")).toHaveLength(3);
    expect(used(U2)).toBe(2);
    expect(resumes(U2)).toBe(2);
    expect(Number(pg!.psql(`select count(*) from public.generation_requests where user_id = '${U2}' and status = 'failed' and failure = 'credits_exhausted'`))).toBe(3);
  });

  it("an uncharged completion (creator or free regeneration) does not touch credits", () => {
    const key = randomUUID();
    const before = used(U3);
    pg!.psql(beginSql(U3, key, fp(200)));
    expect(pg!.psql(completeSql(U3, key, false))).toMatch(/^completed\|/);
    expect(used(U3)).toBe(before);
  });

  it("an abandoned attempt stops blocking after its lease; completing it late writes nothing", () => {
    const stale = randomUUID();
    pg!.psql(beginSql(U3, stale, fp(300), 30));
    pg!.psql(`update public.generation_requests set lease_expires_at = now() - interval '1 second' where request_key = '${stale}'`);
    const fresh = randomUUID();
    expect(pg!.psql(beginSql(U3, fresh, fp(300)))).toBe("started|");
    const before = resumes(U3);
    expect(pg!.psql(completeSql(U3, stale, false))).toBe("expired|");
    expect(resumes(U3)).toBe(before);
  });

  it("settled attempts older than 24 h are cleaned up on the user's next begin", () => {
    pg!.psql(`update public.generation_requests set created_at = now() - interval '25 hours' where user_id = '${U2}'`);
    pg!.psql(beginSql(U2, randomUUID(), fp(400)));
    expect(Number(pg!.psql(`select count(*) from public.generation_requests where user_id = '${U2}' and status <> 'pending'`))).toBe(0);
    // Resumes they produced are untouched; only the link is cleared.
    expect(resumes(U2)).toBe(2);
    expect(Number(pg!.psql(`select count(*) from public.resumes where user_id = '${U2}' and generation_request_id is null`))).toBe(2);
  });

  it("lineage is kept only to the user's own resume", () => {
    const own = pg!.psql(`select id from public.resumes where user_id = '${U1}' limit 1`);
    const other = pg!.psql(`select id from public.resumes where user_id = '${U2}' limit 1`);
    const k1 = randomUUID(), k2 = randomUUID();
    pg!.psql(beginSql(U1, k1, fp(500)));
    const [, id1] = pg!.psql(completeSql(U1, k1, false, resumeJson({ regen_of_resume_id: own }))).split("|");
    pg!.psql(beginSql(U1, k2, fp(501)));
    const [, id2] = pg!.psql(completeSql(U1, k2, false, resumeJson({ regen_of_resume_id: other }))).split("|");
    expect(pg!.psql(`select coalesce(regen_of_resume_id::text, 'null') from public.resumes where id = '${id1}'`)).toBe(own);
    expect(pg!.psql(`select coalesce(regen_of_resume_id::text, 'null') from public.resumes where id = '${id2}'`)).toBe("null");
  });

  it("browsers cannot read the table or call the functions", () => {
    for (const role of ["authenticated", "anon"]) {
      const as = (sql: string) => `set role ${role}; set request.jwt.claim.sub = '${U1}'; ${sql}`;
      expect(() => pg!.psql(as("select count(*) from public.generation_requests"))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(beginSql(U1, randomUUID(), fp(600))))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(completeSql(U1, randomUUID(), false)))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(`select public.fail_resume_generation('${U1}', '${randomUUID()}', 'x')`))).toThrow(/permission denied/);
    }
  });

  it("backward compatible: the currently deployed browser INSERT still works", () => {
    const before = resumes(U1);
    pg!.psql(`set role authenticated; set request.jwt.claim.sub = '${U1}';
      insert into public.resumes (user_id, jd_text, resume_json) values ('${U1}', 'jd', '{}'::jsonb);
      insert into public.resumes (user_id, jd_text, resume_json) values ('${U1}', 'jd', '{}'::jsonb);`);
    expect(resumes(U1)).toBe(before + 2);
  });

  it("one attempt can never own two resumes (unique generation_request_id)", () => {
    const req = pg!.psql(`select id from public.generation_requests where status = 'completed' limit 1`);
    expect(() => pg!.psql(`insert into public.resumes (user_id, jd_text, resume_json, generation_request_id) values ('${U1}', 'jd', '{}', '${req}')`))
      .toThrow(/duplicate key value violates unique constraint "resumes_generation_request_id_key"/);
  });

  it("rollback removes 013 cleanly and keeps every resume", () => {
    const before = Number(pg!.psql(`select count(*) from public.resumes`));
    pg!.psqlFile(ROLLBACK);
    expect(Number(pg!.psql(`select count(*) from public.resumes`))).toBe(before);
    expect(pg!.psql(`select to_regclass('public.generation_requests') is null`)).toBe("t");
    expect(pg!.psql(`select count(*) from information_schema.columns where table_name = 'resumes' and column_name = 'generation_request_id'`)).toBe("0");
    // The pre-013 flow works after rollback, and 013 re-applies cleanly.
    pg!.psql(`set role authenticated; set request.jwt.claim.sub = '${U1}'; insert into public.resumes (user_id, jd_text, resume_json) values ('${U1}', 'jd', '{}'::jsonb);`);
    pg!.psqlFile(path.join(MIGRATIONS, "013_generation_idempotency.sql"));
    expect(pg!.psql(beginSql(U1, randomUUID(), fp(700)))).toBe("started|");
  });
});
