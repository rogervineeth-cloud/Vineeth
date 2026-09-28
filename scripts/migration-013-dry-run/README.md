# Migration 013 dry-run on a copy of the production schema

`run.sh` checks that `supabase/migrations/013_generation_idempotency.sql`
applies cleanly to **the schema production actually has** — including the
hand-applied and drifted migrations (e.g. `007_lock_down_user_plans_writes`,
which is in production's history but not in this repo) — before anyone
applies it to production.

It never writes to the source database. It only reads its **schema** (no
rows), restores that into a throwaway local PostgreSQL 17, and runs every
check there.

## What it does

1. **Dump (only when explicitly invoked).** With
   `--confirm-read-production-schema`, runs
   `pg_dump --schema-only --schema=public --no-owner` against
   `$SUPABASE_DB_URL` in a session forced read-only
   (`default_transaction_read_only=on`). No data is dumped; a dump containing
   `INSERT`/`COPY` statements is refused. Alternatively `--schema-file FILE`
   uses a dump you already took, and makes no connection at all.
2. **Disposable database.** Starts PostgreSQL 17 (production's major) from
   local binaries in a private `mktemp` directory (unix socket only, no TCP),
   or in a throwaway Docker container (`postgres:17`, no published port).
3. **Restore.** Loads `stubs.sql` (the Supabase roles, `auth.users`,
   `auth.uid()`, which a `public`-only dump references but does not contain),
   creates any other role the dump grants to, and restores the schema.
4. **Checks.**
   - `preflight.sql` (before 013): base tables exist; 013's names are free;
     the API roles have `USAGE` on `public`; `service_role` can `UPDATE`
     `user_plans`; notes any user triggers; snapshots policies and columns.
   - apply 013.
   - `postcheck.sql`: objects exist as specified (partial unique index,
     unique key, nullable `resumes.generation_request_id` + unique index,
     three functions with empty `search_path`, RLS on); **access** (only
     `service_role` can execute the functions or touch the table — this is
     where production's "functions are not executable by default" setting
     matters); **behaviour** as `service_role` (started / in_progress /
     completed / replay / key_reused / payment_required, one charge, one
     linked resume); the **current browser INSERT** still works; **nothing
     pre-existing changed** (every policy and column identical; exactly one
     new column).
   - **Concurrency**: 8 identical `begin` calls on 8 separate connections at
     once → exactly 1 `started`, 7 `in_progress`.
   - **Rollback**: `supabase/rollback/013_generation_idempotency_down.sql`
     removes 013 and keeps every resume; 013 then re-applies cleanly.
5. **Cleanup, always** (success, failure, Ctrl-C): stops the database or
   removes the container, and deletes the temp directory — including the
   dump. Prints `Cleaned up (...)`.

Exit codes: `0` passed · `1` a check or step failed (message says which) ·
`2` refused / usage (nothing was done).

## What you need to provide or confirm

| Needed | Why | Where |
| --- | --- | --- |
| **A database connection string with the DB password**, in the `SUPABASE_DB_URL` environment variable | `pg_dump` must log in to read the schema and its grants | Supabase dashboard → *Connect* → **Session pooler** (IPv4; user `postgres.<project-ref>`, host `aws-0-ap-southeast-1.pooler.supabase.com`, port `5432`) or **Direct connection** (IPv6 only, `db.<project-ref>.supabase.co:5432`). Do **not** use the transaction pooler (port 6543). If you do not have the password, *Reset database password* on the same page — note that resetting changes it for every existing user of it. |
| **Your explicit confirmation**, by passing `--confirm-read-production-schema` | Without it the script connects to nothing and exits `2` | on the command line |
| **PostgreSQL 17** `pg_dump` + server (`initdb`, `pg_ctl`, `psql`) — or **Docker** | Production is PostgreSQL 17.6; an older `pg_dump` refuses to dump it, and the copy should run on the same major | `brew install postgresql@17` / `apt install postgresql-17`, then `PG_BIN=<its bin dir>`; or Docker Desktop |
| **Network access** from where you run it to the host above | the dump connection | your machine; this repository's cloud sandbox has neither PostgreSQL 17 nor, typically, egress to the database |

Keep the password out of shell history and chat: read it with `read -s`, as
below. The script refuses a connection string passed as an argument, never
prints it, and does not write it to disk.

**Effect on production:** one read-only connection for a few seconds.
`pg_dump` takes `ACCESS SHARE` locks on the `public` tables while it runs,
which do not block reads or writes (only `ALTER`/`DROP TABLE`). Nothing is
created, changed or recorded in production.

## Running it

```bash
# From the repository root, on a machine with PostgreSQL 17 (or Docker).
read -s -p "Supabase DB connection string: " SUPABASE_DB_URL && export SUPABASE_DB_URL && echo
scripts/migration-013-dry-run/run.sh --confirm-read-production-schema      # auto: local PG17 if found, else Docker
unset SUPABASE_DB_URL
```

Two-step alternative — take the schema dump yourself, then run with no
connection:

```bash
PGOPTIONS="-c default_transaction_read_only=on" pg_dump --schema-only --schema=public --no-owner \
  --dbname="$SUPABASE_DB_URL" --file=public-schema.sql
scripts/migration-013-dry-run/run.sh --schema-file public-schema.sql
rm public-schema.sql
```

A passing run ends with `DRY-RUN PASSED` and `Cleaned up (...)`. Anything
else names the failed check; nothing needs cleaning up by hand.

## Testing the script itself (no production access)

Build a stand-in schema locally from this repo's migrations (with Supabase's
explicit `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`
and production's default privileges), dump it, and run:

```bash
DRYRUN_PG_MAJOR=16 scripts/migration-013-dry-run/run.sh --schema-file standin.sql --local
```

`DRYRUN_PG_MAJOR` exists only for this; the real dry-run must use 17.
Verified this way on 2026-09-26: all checks pass; a copy of 013 without its
`service_role` grants fails the access check; a dump without schema `USAGE`
grants fails preflight; Ctrl-C mid-run still stops the database and removes
the temp directory.

## Limits

- `public` schema only. `auth` and `storage` are stubbed, not copied —
  013 touches neither.
- Supabase's own event triggers and extensions outside `public` are not
  reproduced.
- It validates the schema change, grants and SQL behaviour. It does not
  exercise PostgREST's RPC layer or the app; the post-apply checks in the
  rollout plan cover those.
