#!/usr/bin/env bash
# Migration 013 dry-run against a copy of the production SCHEMA.
#
#   1. (only with --confirm-read-production-schema) pg_dump --schema-only of
#      the `public` schema from $SUPABASE_DB_URL, over a read-only session.
#      No data rows are dumped. Nothing is written to that database.
#      — or skip the connection entirely with --schema-file <dump.sql>.
#   2. Start a disposable local PostgreSQL (default major 17, matching
#      production), in a private temp directory or a throwaway Docker container.
#   3. Load Supabase stubs, restore the schema, run preflight checks,
#      apply supabase/migrations/013_generation_idempotency.sql, run postchecks,
#      a real concurrency check (parallel connections), then the rollback
#      script and a re-apply.
#   4. Always: stop the database and delete the temp directory (dump included),
#      on success, failure or Ctrl-C.
#
# See scripts/migration-013-dry-run/README.md for prerequisites and usage.

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIGRATION="$REPO/supabase/migrations/013_generation_idempotency.sql"
ROLLBACK="$REPO/supabase/rollback/013_generation_idempotency_down.sql"
TARGET_MAJOR="${DRYRUN_PG_MAJOR:-17}"   # production is PostgreSQL 17
DOCKER_IMAGE="postgres:${TARGET_MAJOR}"

CONFIRM=0
SCHEMA_FILE=""
MODE="auto"   # auto | local | docker

usage() {
  cat <<'EOF'
Usage:
  SUPABASE_DB_URL=... scripts/migration-013-dry-run/run.sh --confirm-read-production-schema [--local|--docker]
  scripts/migration-013-dry-run/run.sh --schema-file path/to/public-schema.sql [--local|--docker]

  --confirm-read-production-schema  Required to connect to $SUPABASE_DB_URL and take a
                                    schema-only, read-only dump of the public schema.
  --schema-file FILE                Use an existing schema-only dump; no remote connection.
  --local | --docker                Where the disposable database runs (default: local
                                    PostgreSQL binaries if found, else Docker).

Environment:
  SUPABASE_DB_URL   Connection string (read from the environment only; never pass it as an
                    argument and never commit it). Not needed with --schema-file.
  PG_BIN            Directory with initdb/pg_ctl/psql/pg_dump for PostgreSQL 17.
  DRYRUN_PG_MAJOR   Target major version (default 17). Only lower it to test the script itself.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm-read-production-schema) CONFIRM=1 ;;
    --schema-file) SCHEMA_FILE="${2:-}"; shift ;;
    --local) MODE="local" ;;
    --docker) MODE="docker" ;;
    -h|--help) usage; exit 0 ;;
    postgres://*|postgresql://*) echo "Refusing a connection string as an argument (it would land in shell history). Use SUPABASE_DB_URL." >&2; exit 2 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nDRY-RUN FAILED: %s\n' "$*" >&2; exit 1; }

if [[ -n "$SCHEMA_FILE" ]]; then
  [[ -r "$SCHEMA_FILE" ]] || fail "cannot read --schema-file $SCHEMA_FILE"
  if [[ $CONFIRM -eq 1 ]]; then fail "use either --schema-file or --confirm-read-production-schema, not both"; fi
else
  if [[ $CONFIRM -ne 1 ]]; then
    echo "Nothing done. Reading the production schema needs --confirm-read-production-schema (or use --schema-file)." >&2
    usage >&2
    exit 2
  fi
  [[ -n "${SUPABASE_DB_URL:-}" ]] || fail "SUPABASE_DB_URL is not set"
fi
[[ -r "$MIGRATION" && -r "$ROLLBACK" ]] || fail "migration or rollback file missing"

# ── tools ───────────────────────────────────────────────────────────────────
find_pg_bin() {
  local d
  for d in "${PG_BIN:-}" "/usr/lib/postgresql/$TARGET_MAJOR/bin" "/opt/homebrew/opt/postgresql@$TARGET_MAJOR/bin" \
           "/usr/local/opt/postgresql@$TARGET_MAJOR/bin" "/Applications/Postgres.app/Contents/Versions/$TARGET_MAJOR/bin"; do
    [[ -n "$d" && -x "$d/initdb" && -x "$d/pg_ctl" && -x "$d/psql" ]] && { echo "$d"; return 0; }
  done
  return 1
}
major_of() { "$1" --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)?.*/\1/'; }

BIN=""
if [[ "$MODE" != "docker" ]] && BIN="$(find_pg_bin)"; then
  [[ "$(major_of "$BIN/initdb")" == "$TARGET_MAJOR" ]] || fail "$BIN is not PostgreSQL $TARGET_MAJOR"
  MODE="local"
elif [[ "$MODE" != "local" ]] && command -v docker >/dev/null 2>&1; then
  MODE="docker"
else
  fail "need PostgreSQL $TARGET_MAJOR server binaries (set PG_BIN) or Docker"
fi

# ── workspace + guaranteed cleanup ─────────────────────────────────────────
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ndrs-013-dryrun.XXXXXX")"
chmod 700 "$WORK"
CONTAINER=""
AS_POSTGRES=0
PGDATA_DIR="$WORK/data"
PORT=$(( 40000 + RANDOM % 20000 ))

cleanup() {
  local code=$?
  set +e
  if [[ -n "$CONTAINER" ]]; then docker rm -f "$CONTAINER" >/dev/null 2>&1; fi
  if [[ "$MODE" == "local" && -f "$PGDATA_DIR/PG_VERSION" ]]; then
    if [[ $AS_POSTGRES -eq 1 ]]; then su postgres -c "'$BIN/pg_ctl' -D '$PGDATA_DIR' -m immediate -w stop" >/dev/null 2>&1
    else "$BIN/pg_ctl" -D "$PGDATA_DIR" -m immediate -w stop >/dev/null 2>&1; fi
  fi
  rm -rf "$WORK"
  if [[ -d "$WORK" ]]; then echo "WARNING: could not remove $WORK" >&2; else echo "Cleaned up (database stopped, $WORK removed)."; fi
  exit $code
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ── 1. schema dump (read-only, schema only, public only) ───────────────────
DUMP="$WORK/public-schema.sql"
if [[ -n "$SCHEMA_FILE" ]]; then
  log "Using schema file $SCHEMA_FILE (no remote connection)"
  cp "$SCHEMA_FILE" "$DUMP"
else
  log "Dumping the production public SCHEMA (no data, read-only session)"
  DUMP_ARGS=(--schema-only --schema=public --no-owner --no-subscriptions --no-publications)
  if [[ "$MODE" == "local" && -x "$BIN/pg_dump" ]]; then
    # A read-only session: even a mistaken statement could not write.
    PGOPTIONS="-c default_transaction_read_only=on" "$BIN/pg_dump" "${DUMP_ARGS[@]}" --dbname="$SUPABASE_DB_URL" --file="$DUMP" \
      || fail "pg_dump failed (see README: use the direct or session-pooler connection string, pg_dump >= 17)"
  else
    command -v docker >/dev/null 2>&1 || fail "no pg_dump $TARGET_MAJOR available (set PG_BIN or install Docker)"
    # The URL is passed by variable name, so it is not on the docker command line.
    docker run --rm -e SUPABASE_DB_URL -e PGOPTIONS="-c default_transaction_read_only=on" "$DOCKER_IMAGE" \
      pg_dump "${DUMP_ARGS[@]}" --dbname="\$SUPABASE_DB_URL" >"$DUMP" 2>"$WORK/pg_dump.err" \
      || { sed 's/postgres\(ql\)\?:\/\/[^ ]*/<redacted>/g' "$WORK/pg_dump.err" >&2; fail "pg_dump failed"; }
  fi
fi
grep -qiE 'INSERT INTO|^COPY ' "$DUMP" && fail "the dump contains data statements; refusing to use it (schema only expected)"
SOURCE_MAJOR="$(sed -nE 's/^-- Dumped from database version ([0-9]+).*/\1/p' "$DUMP" | head -1)"
if [[ -n "$SOURCE_MAJOR" && "$SOURCE_MAJOR" -gt "$TARGET_MAJOR" ]]; then
  fail "dump is from PostgreSQL $SOURCE_MAJOR but the dry-run database is $TARGET_MAJOR"
fi
echo "Schema dump: $(wc -l <"$DUMP") lines, from PostgreSQL ${SOURCE_MAJOR:-unknown}."

# ── 2. disposable local database ────────────────────────────────────────────
log "Starting a disposable PostgreSQL $TARGET_MAJOR ($MODE)"
if [[ "$MODE" == "local" ]]; then
  if [[ $(id -u) -eq 0 ]]; then AS_POSTGRES=1; chown postgres "$WORK"; fi
  run_pg() { if [[ $AS_POSTGRES -eq 1 ]]; then su postgres -c "$(printf '%q ' "$@")"; else "$@"; fi; }
  run_pg "$BIN/initdb" -D "$PGDATA_DIR" -A trust -U postgres >/dev/null
  run_pg "$BIN/pg_ctl" -D "$PGDATA_DIR" -w -l "$WORK/server.log" \
    -o "-p $PORT -k $WORK -c listen_addresses= -c fsync=off" start >/dev/null
  psql_() { "$BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
else
  CONTAINER="ndrs-013-dryrun-$$"
  docker run -d --rm --name "$CONTAINER" -e POSTGRES_HOST_AUTH_METHOD=trust "$DOCKER_IMAGE" -c fsync=off >/dev/null
  for _ in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || fail "container did not start"
  psql_() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
fi
psql_ -tAc "select 'local server ' || version()" | sed 's/ on .*//'

# ── 3. restore ──────────────────────────────────────────────────────────────
log "Loading Supabase stubs and restoring the schema"
psql_ <"$HERE/stubs.sql" >/dev/null
# Any other role the dump grants to must exist locally.
roles=$(grep -oE '(TO|FROM|FOR ROLE) "?[a-z_][a-z0-9_]*' "$DUMP" | awk '{print $NF}' | tr -d '"' | sort -u \
        | grep -vxE 'public|current_user|session_user|group|role' || true)
for r in $roles; do
  psql_ -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$r') then create role \"$r\" nologin; end if; end \$\$;" >/dev/null
done
psql_ -c "drop schema public cascade" >/dev/null
psql_ <"$DUMP" >"$WORK/restore.log" 2>&1 || { tail -20 "$WORK/restore.log" >&2; fail "restoring the schema failed (see above)"; }
echo "Restored: $(psql_ -tAc "select count(*) from pg_tables where schemaname = 'public'") tables, $(psql_ -tAc "select count(*) from pg_policies where schemaname = 'public'") policies."

# ── 4. checks ───────────────────────────────────────────────────────────────
# Run a SQL file; show its PREFLIGHT/CHECK lines and errors; fail with a
# message (not a bare psql exit code) if it errors.
run_sql_step() {
  local name="$1" file="$2" rc=0
  psql_ <"$file" >"$WORK/$name.out" 2>&1 || rc=$?
  grep -E 'PREFLIGHT|CHECK|ERROR' "$WORK/$name.out" | sed 's/^psql:[^ ]* //' || true
  [[ $rc -eq 0 ]] || fail "$name failed"
}

log "Preflight (before 013)"
run_sql_step preflight "$HERE/preflight.sql"

log "Applying migration 013"
run_sql_step migration "$MIGRATION"

log "Postchecks"
run_sql_step postcheck "$HERE/postcheck.sql"
[[ $(grep -c 'CHECK OK' "$WORK/postcheck.out") -eq 5 ]] || fail "not all postchecks reported OK"

log "Concurrency: 8 identical begins on 8 connections at once"
USER_ID="dddddddd-0000-4000-8000-0000000000c0"
psql_ -c "insert into auth.users (id) values ('$USER_ID')" >/dev/null
pids=()
for i in $(seq 1 8); do
  ( psql_ -tAc "set role service_role; select outcome from public.begin_resume_generation('$USER_ID', gen_random_uuid(), repeat('c', 64))" \
      >"$WORK/concurrent.$i" 2>&1 ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done
started=$(cat "$WORK"/concurrent.* | grep -cx started || true)
inprog=$(cat "$WORK"/concurrent.* | grep -cx in_progress || true)
echo "started=$started in_progress=$inprog"
[[ "$started" -eq 1 && "$inprog" -eq 7 ]] || { cat "$WORK"/concurrent.* >&2; fail "expected exactly 1 started and 7 in_progress"; }
echo "CHECK OK: concurrency"

log "Rollback, then re-apply"
run_sql_step rollback "$ROLLBACK"
[[ "$(psql_ -tAc "select to_regclass('public.generation_requests') is null")" == "t" ]] || fail "rollback left generation_requests"
[[ "$(psql_ -tAc "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'resumes' and column_name = 'generation_request_id'")" == "0" ]] \
  || fail "rollback left resumes.generation_request_id"
[[ "$(psql_ -tAc "select count(*) from public.resumes")" -ge 1 ]] || fail "rollback removed resumes"
run_sql_step reapply "$MIGRATION"
[[ "$(psql_ -tAc "set role service_role; select outcome from public.begin_resume_generation('$USER_ID', gen_random_uuid(), repeat('e', 64))")" == "started" ]] \
  || fail "013 did not re-apply cleanly"
echo "CHECK OK: rollback keeps resumes; 013 re-applies"

log "DRY-RUN PASSED: migration 013 applies to the production schema copy; all checks passed."
