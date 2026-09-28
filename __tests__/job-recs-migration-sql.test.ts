/**
 * Migration 016 (AI Job Recommendations) against a real PostgreSQL
 * (throwaway local cluster; see helpers/local-postgres.ts), migrations
 * 001-016 in order, then the rollback.
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
const ROLLBACK = path.join(__dirname, "..", "supabase", "rollback", "016_job_recommendations_down.sql");
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const RACER = "33333333-3333-4333-8333-333333333333";
const FP = "a".repeat(64);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const as = (role: string, user: string, sql: string) => `set role ${role}; set request.jwt.claim.sub = '${user}'; ${sql}`;
const item = (id: string, url = `https://jobs.example.com/${id}`, score = 80) => ({
  provider_job_id: id, title: `Job ${id}`, company: "Example", location: "Kochi", remote: false,
  apply_url: url, posted_at: null, score, components: { skills: { score: 1, weight: 0.5, reason: "r" } },
});
const record = (u: string, key: string, items: unknown[], max = 5) =>
  `select outcome || ':' || coalesce(run_id::text, '') from public.record_job_rec_run('${u}', '${key}', 'fixture', 'v1', '${FP}', 'results', 0, ${q(JSON.stringify(items))}::jsonb, ${max})`;
const outcome = (s: string) => s.split(":")[0];

d("migration 016 (job recommendations) on PostgreSQL", () => {
  beforeAll(() => {
    pg!.start();
    for (const f of fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) pg!.psqlFile(path.join(MIGRATIONS, f));
    pg!.psql(`insert into auth.users values ('${ALICE}'), ('${BOB}'), ('${RACER}')`);
  });
  afterAll(() => pg!.stop());

  it("re-applying the migration is harmless", () => {
    expect(() => pg!.psqlFile(path.join(MIGRATIONS, "016_job_recommendations.sql"))).not.toThrow();
  });

  it("no consent: nothing is recorded", () => {
    expect(outcome(pg!.psql(record(ALICE, randomUUID(), [item("1")])))).toBe("consent_required");
    expect(pg!.psql(`select count(*) from public.job_rec_runs`)).toBe("0");
  });

  it("records a run with its items; the same request_key replays it", () => {
    pg!.psql(`select public.grant_job_rec_consent('${ALICE}', 'v-test')`);
    const key = randomUUID();
    const first = pg!.psql(record(ALICE, key, [item("1"), item("2", undefined, 60)]));
    expect(outcome(first)).toBe("created");
    const again = pg!.psql(record(ALICE, key, [item("3")]));
    expect(again).toBe(first.replace("created", "replay"));
    expect(pg!.psql(`select outcome from public.check_job_rec_run('${ALICE}', '${key}', 5)`)).toBe("replay");
    expect(pg!.psql(`select string_agg(provider_job_id, ',' order by score desc) from public.job_recommendations where user_id = '${ALICE}'`)).toBe("1,2");
  });

  it("rejects non-https apply links at the database too", () => {
    expect(() => pg!.psql(record(ALICE, randomUUID(), [item("x", "http://jobs.example.com/x")]))).toThrow(/check constraint/);
    expect(() => pg!.psql(record(ALICE, randomUUID(), [item("y", "javascript:alert(1)")]))).toThrow(/check constraint/);
    expect(() => pg!.psql(record(ALICE, randomUUID(), [item("z", "https://user@jobs.example.com/z")]))).toThrow(/check constraint/);
  });

  it("RLS: owners read only their own rows; the browser role can write nothing", () => {
    pg!.psql(`select public.grant_job_rec_consent('${BOB}', 'v-test')`);
    expect(outcome(pg!.psql(record(BOB, randomUUID(), [item("b1")])))).toBe("created");
    expect(pg!.psql(as("authenticated", ALICE, `select count(*) from public.job_recommendations where user_id <> '${ALICE}'`))).toBe("0");
    expect(pg!.psql(as("authenticated", ALICE, `select count(*) from public.job_rec_runs where user_id <> '${ALICE}'`))).toBe("0");
    expect(pg!.psql(as("authenticated", ALICE, `select count(*) from public.job_rec_consents`))).toBe("1");
    expect(Number(pg!.psql(as("authenticated", ALICE, `select count(*) from public.job_recommendations`)))).toBeGreaterThan(0);
    const bobRec = pg!.psql(`select id from public.job_recommendations where user_id = '${BOB}' limit 1`);
    for (const sql of [
      `update public.job_recommendations set status = 'saved' where id = '${bobRec}'`,
      `update public.job_recommendations set score = 100`,
      `delete from public.job_rec_runs`,
      `insert into public.job_rec_consents values ('${ALICE}', 'x', now())`,
      `insert into public.job_rec_runs (user_id, request_key, provider, scoring_version, profile_fingerprint, status) values ('${ALICE}', '${randomUUID()}', 'fixture', 'v1', '${FP}', 'results')`,
      `select public.set_job_rec_status('${ALICE}', '${bobRec}', 'saved')`,
      `select public.grant_job_rec_consent('${ALICE}', 'x')`,
      `select public.revoke_job_rec_consent('${BOB}')`,
      `select * from public.check_job_rec_run('${ALICE}', '${randomUUID()}', 5)`,
      record(ALICE, randomUUID(), [item("h")]),
    ]) {
      expect(() => pg!.psql(as("authenticated", ALICE, sql))).toThrow(/permission denied/);
    }
    expect(() => pg!.psql(as("anon", ALICE, `select * from public.job_recommendations`))).toThrow(/permission denied/);
  });

  it("set_job_rec_status only changes the caller's own recommendation", () => {
    const bobRec = pg!.psql(`select id from public.job_recommendations where user_id = '${BOB}' limit 1`);
    expect(pg!.psql(`select public.set_job_rec_status('${ALICE}', '${bobRec}', 'dismissed')`)).toBe("f");
    expect(pg!.psql(`select status from public.job_recommendations where id = '${bobRec}'`)).toBe("new");
    expect(pg!.psql(`select public.set_job_rec_status('${BOB}', '${bobRec}', 'saved')`)).toBe("t");
    expect(() => pg!.psql(`select public.set_job_rec_status('${BOB}', '${bobRec}', 'applied')`)).toThrow(/invalid status/);
  });

  it("new runs leave out dismissed jobs and keep saved ones saved", () => {
    const one = pg!.psql(`select id from public.job_recommendations where user_id = '${ALICE}' and provider_job_id = '1' limit 1`);
    const two = pg!.psql(`select id from public.job_recommendations where user_id = '${ALICE}' and provider_job_id = '2' limit 1`);
    pg!.psql(`select public.set_job_rec_status('${ALICE}', '${one}', 'dismissed')`);
    pg!.psql(`select public.set_job_rec_status('${ALICE}', '${two}', 'saved')`);
    const run = pg!.psql(record(ALICE, randomUUID(), [item("1"), item("2"), item("4")])).split(":")[1];
    expect(pg!.psql(`select string_agg(provider_job_id || '=' || status, ',' order by provider_job_id) from public.job_recommendations where run_id = '${run}'`))
      .toBe("2=saved,4=new");
  });

  it("rate limit holds under concurrency: 8 simultaneous runs with max 5 → exactly 5 created", async () => {
    pg!.psql(`select public.grant_job_rec_consent('${RACER}', 'v-test')`);
    const results = await pg!.concurrently(Array.from({ length: 8 }, () => record(RACER, randomUUID(), [item("r")])));
    expect(results.every((r) => r.code === 0)).toBe(true);
    const outs = results.map((r) => outcome(r.out));
    expect(outs.filter((o) => o === "created")).toHaveLength(5);
    expect(outs.filter((o) => o === "rate_limited")).toHaveLength(3);
    const c = pg!.psql(`select outcome || '|' || (retry_after > 0)::text from public.check_job_rec_run('${RACER}', '${randomUUID()}', 5)`);
    expect(c).toBe("rate_limited|true");
  });

  it("the same request_key racing itself stores one run", async () => {
    pg!.psql(`select public.grant_job_rec_consent('${RACER}', 'v-test')`);
    const key = randomUUID();
    const results = await pg!.concurrently(Array.from({ length: 6 }, () => record(RACER, key, [item("k")], 100)));
    const outs = results.map((r) => outcome(r.out));
    expect(outs.filter((o) => o === "created")).toHaveLength(1);
    expect(outs.filter((o) => o === "replay")).toHaveLength(5);
    expect(pg!.psql(`select count(*) from public.job_rec_runs where request_key = '${key}'`)).toBe("1");
  });

  it("revoking consent deletes the user's runs and recommendations only", () => {
    pg!.psql(`select public.revoke_job_rec_consent('${ALICE}')`);
    expect(pg!.psql(`select count(*) from public.job_recommendations where user_id = '${ALICE}'`)).toBe("0");
    expect(pg!.psql(`select count(*) from public.job_rec_runs where user_id = '${ALICE}'`)).toBe("0");
    expect(pg!.psql(`select count(*) from public.job_rec_consents where user_id = '${ALICE}'`)).toBe("0");
    expect(Number(pg!.psql(`select count(*) from public.job_recommendations where user_id = '${BOB}'`))).toBeGreaterThan(0);
  });

  it("rollback removes the feature and leaves existing tables alone", () => {
    pg!.psqlFile(ROLLBACK);
    expect(pg!.psql(`select count(*) from pg_tables where schemaname = 'public' and tablename like 'job_rec%'`)).toBe("0");
    expect(pg!.psql(`select count(*) from pg_proc where proname like '%job_rec%'`)).toBe("0");
    expect(pg!.psql(`select count(*) from pg_tables where schemaname = 'public' and tablename in ('profiles', 'resumes', 'user_plans')`)).toBe("3");
    pg!.psqlFile(path.join(MIGRATIONS, "016_job_recommendations.sql"));
  });
});
