/**
 * Migration 014 against a real PostgreSQL (throwaway local cluster; see
 * helpers/local-postgres.ts): migrations 001-014 in order, then what the
 * browser role can and cannot do to public.resumes.
 *
 * The gap it closes: with INSERT and UPDATE on resumes, a signed-in user
 * could insert a resume without paying for generation, or set downloaded_at /
 * created_at on their own resumes to unlock downloads.
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
const ROLLBACK = path.join(__dirname, "..", "supabase", "rollback", "014_resumes_server_writes_only_down.sql");
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const as = (role: string, user: string, sql: string) => `set role ${role}; set request.jwt.claim.sub = '${user}'; ${sql}`;

d("migration 014 on PostgreSQL", () => {
  let mine = "";
  let theirs = "";

  beforeAll(() => {
    pg!.start();
    for (const f of fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) pg!.psqlFile(path.join(MIGRATIONS, f));
    pg!.psql(`insert into auth.users values ('${OWNER}'), ('${OTHER}')`);
    pg!.psql(`insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, expires_at)
              values ('${OWNER}', 'single', 3, 0, now() + interval '2 days')`);
    mine = pg!.psql(`insert into public.resumes (user_id, jd_text, resume_json) values ('${OWNER}', 'jd', '{"summary":"s"}') returning id`);
    theirs = pg!.psql(`insert into public.resumes (user_id, jd_text, resume_json) values ('${OTHER}', 'jd', '{}') returning id`);
  });
  afterAll(() => pg!.stop());

  const count = (user: string) => Number(pg!.psql(`select count(*) from public.resumes where user_id = '${user}'`));

  it("014 is the last migration and is in the list the suites apply", () => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    expect(files[files.length - 1]).toBe("014_resumes_server_writes_only.sql");
  });

  it.each(["authenticated", "anon"])("%s cannot INSERT a resume (not even their own)", (role) => {
    const before = count(OWNER);
    expect(() => pg!.psql(as(role, OWNER, `insert into public.resumes (user_id, jd_text, resume_json) values ('${OWNER}', 'forged', '{}')`)))
      .toThrow(/permission denied/);
    expect(count(OWNER)).toBe(before);
  });

  it.each([
    ["downloaded_at", "now()"],
    ["created_at", "now() - interval '1 year'"],
    ["resume_json", `'{"summary":"forged"}'::jsonb`],
    ["user_id", `'${OTHER}'`],
  ])("the owner cannot UPDATE %s on their own resume", (column, value) => {
    const before = pg!.psql(`select ${column}::text from public.resumes where id = '${mine}'`);
    expect(() => pg!.psql(as("authenticated", OWNER, `update public.resumes set ${column} = ${value} where id = '${mine}'`)))
      .toThrow(/permission denied/);
    expect(pg!.psql(`select ${column}::text from public.resumes where id = '${mine}'`)).toBe(before);
  });

  it("the owner can still read their own resumes, and only theirs", () => {
    expect(pg!.psql(as("authenticated", OWNER, `select string_agg(id::text, ',') from public.resumes`))).toBe(mine);
  });

  it("the owner can still delete their own resume (dashboard), not someone else's", () => {
    const extra = pg!.psql(`insert into public.resumes (user_id, jd_text, resume_json) values ('${OWNER}', 'jd', '{}') returning id`);
    pg!.psql(as("authenticated", OWNER, `delete from public.resumes where id = '${theirs}'`)); // RLS: matches nothing
    expect(count(OTHER)).toBe(1);
    pg!.psql(as("authenticated", OWNER, `delete from public.resumes where id = '${extra}'`));
    expect(Number(pg!.psql(`select count(*) from public.resumes where id = '${extra}'`))).toBe(0);
  });

  it("the server path still works: generation completes and inserts, and the download route can mark downloaded_at", () => {
    const key = randomUUID();
    const fp = "a".repeat(64);
    const row = JSON.stringify({ jd_text: "jd", resume_json: { summary: "x" }, ats_score: 70, tailored_role: "Analyst",
      matched_keywords: [], missing_keywords: [], contact_snapshot: { full_name: "QA" }, template: "classic", regen_of_resume_id: null });
    const before = count(OWNER);
    expect(pg!.psql(as("service_role", OWNER, `select outcome from public.begin_resume_generation('${OWNER}', '${key}', '${fp}', 150)`))).toBe("started");
    const [outcome, id] = pg!.psql(as("service_role", OWNER,
      `select outcome || '|' || resume_id from public.complete_resume_generation('${OWNER}', '${key}', true, ${q(row)}::jsonb)`)).split("|");
    expect(outcome).toBe("completed");
    expect(count(OWNER)).toBe(before + 1);
    pg!.psql(as("service_role", OWNER, `update public.resumes set downloaded_at = now() where id = '${id}' and user_id = '${OWNER}'`));
    expect(pg!.psql(`select downloaded_at is not null from public.resumes where id = '${id}'`)).toBe("t");
  });

  it("no INSERT or UPDATE policy remains on resumes; SELECT and DELETE policies are unchanged", () => {
    expect(pg!.psql(`select string_agg(polname || ':' || polcmd::text, ',' order by polname) from pg_policy where polrelid = 'public.resumes'::regclass`))
      .toBe("Users delete own resumes:d,Users view own resumes:r");
  });

  it("rollback restores the browser INSERT/UPDATE (for the pre-PR-#38 flow), and 014 re-applies cleanly", () => {
    pg!.psqlFile(ROLLBACK);
    const before = count(OWNER);
    pg!.psql(as("authenticated", OWNER, `insert into public.resumes (user_id, jd_text, resume_json) values ('${OWNER}', 'jd', '{}')`));
    expect(count(OWNER)).toBe(before + 1);
    // 012's rule is back too: no lineage to someone else's resume.
    expect(() => pg!.psql(as("authenticated", OWNER,
      `insert into public.resumes (user_id, jd_text, resume_json, regen_of_resume_id) values ('${OWNER}', 'jd', '{}', '${theirs}')`))).toThrow(/row-level security/);
    pg!.psqlFile(path.join(MIGRATIONS, "014_resumes_server_writes_only.sql"));
    expect(() => pg!.psql(as("authenticated", OWNER, `insert into public.resumes (user_id, jd_text, resume_json) values ('${OWNER}', 'jd', '{}')`)))
      .toThrow(/permission denied/);
  });
});
