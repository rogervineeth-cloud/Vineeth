/**
 * A throwaway local PostgreSQL cluster for testing migrations for real.
 *
 * Uses the PostgreSQL server binaries if the machine has them (e.g.
 * /usr/lib/postgresql/16/bin); otherwise `available()` is false and callers
 * skip. Never connects to any remote database: the cluster lives in a temp
 * directory, listens only on a unix socket there, and is deleted afterwards.
 *
 * Supabase-specific pieces the migrations rely on are stubbed: the anon /
 * authenticated / service_role roles, auth.users, auth.uid() (read from the
 * request.jwt.claim.sub setting, as in Supabase) and public.rls_auto_enable().
 */
import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BIN_CANDIDATES = ["/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/pgsql/bin"];

function findBin(): string | null {
  for (const dir of BIN_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "initdb")) && fs.existsSync(path.join(dir, "pg_ctl"))) return dir;
  }
  return null;
}

function whichPsql(bin: string): string | null {
  const local = path.join(bin, "psql");
  if (fs.existsSync(local)) return local;
  try { return execFileSync("which", ["psql"], { encoding: "utf8" }).trim() || null; } catch { return null; }
}

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create function public.rls_auto_enable() returns void language sql as $$ select $$;
-- Supabase's defaults: API roles get table, sequence and function privileges
-- on everything created in public (RLS and explicit REVOKEs then narrow it).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export class LocalPostgres {
  private dir = "";
  private port = 0;
  private bin: string;
  private psqlPath: string;
  private asPostgres: boolean;

  private constructor(bin: string, psqlPath: string) {
    this.bin = bin;
    this.psqlPath = psqlPath;
    // initdb refuses to run as root; as root, run the server as `postgres`.
    this.asPostgres = typeof process.getuid === "function" && process.getuid() === 0;
  }

  /** A cluster if this machine can run one, else null (callers skip). */
  static create(): LocalPostgres | null {
    const bin = findBin();
    const psql = bin && whichPsql(bin);
    if (!bin || !psql) return null;
    const pg = new LocalPostgres(bin, psql);
    if (pg.asPostgres) {
      try { execFileSync("id", ["postgres"], { stdio: "ignore" }); } catch { return null; }
    }
    return pg;
  }

  private runServerCmd(args: string[]) {
    const cmd = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
    if (this.asPostgres) execFileSync("su", ["postgres", "-c", cmd], { stdio: "pipe" });
    else execFileSync(args[0], args.slice(1), { stdio: "pipe" });
  }

  start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndrs-pg-"));
    if (this.asPostgres) execFileSync("chown", ["postgres", this.dir]);
    this.port = 40000 + Math.floor(Math.random() * 20000);
    const data = path.join(this.dir, "data");
    this.runServerCmd([path.join(this.bin, "initdb"), "-D", data, "-A", "trust", "-U", "postgres"]);
    this.runServerCmd([
      path.join(this.bin, "pg_ctl"), "-D", data, "-w", "-l", path.join(this.dir, "log"),
      "-o", `-p ${this.port} -k ${this.dir} -c listen_addresses= -c fsync=off`, "start",
    ]);
    this.psql(SUPABASE_STUBS);
  }

  stop() {
    if (!this.dir) return;
    try { this.runServerCmd([path.join(this.bin, "pg_ctl"), "-D", path.join(this.dir, "data"), "-w", "-m", "fast", "stop"]); } catch { /* already down */ }
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = "";
  }

  private args(extra: string[] = []) {
    return ["-h", this.dir, "-p", String(this.port), "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-tA", ...extra];
  }

  /** Run SQL; returns stdout (tuples only, unaligned). Throws on error. */
  psql(sql: string): string {
    return execFileSync(this.psqlPath, this.args(["-c", sql]), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  /** Run a SQL file. */
  psqlFile(file: string): string {
    return execFileSync(this.psqlPath, this.args(["-f", file]), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  /** Run each SQL string on its OWN connection, all at once; resolves to their outputs. */
  concurrently(sqls: string[]): Promise<{ out: string; err: string; code: number | null }[]> {
    return Promise.all(sqls.map((sql) => new Promise<{ out: string; err: string; code: number | null }>((resolve) => {
      const p = spawn(this.psqlPath, this.args(["-c", sql]));
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => resolve({ out: out.trim(), err: err.trim(), code }));
    })));
  }
}
