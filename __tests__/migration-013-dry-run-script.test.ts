/**
 * The migration-013 dry-run script must never touch a database unless it is
 * explicitly told to. These cases all exit before any connection or local
 * database is started (see scripts/migration-013-dry-run/README.md).
 */
import { spawnSync } from "child_process";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "scripts", "migration-013-dry-run", "run.sh");
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    // Minimal environment; the URLs used are TEST-NET addresses and every case exits before connecting.
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    timeout: 20_000,
  });

describe("migration 013 dry-run script: refuses by default", () => {
  it("does nothing without --confirm-read-production-schema, even with SUPABASE_DB_URL set", () => {
    const r = run([], { SUPABASE_DB_URL: "postgresql://nobody:secret@203.0.113.1:5432/postgres" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Nothing done/);
    expect(r.stdout + r.stderr).not.toMatch(/secret/);
  });

  it("refuses a connection string passed as an argument", () => {
    const r = run(["postgresql://nobody:secret@203.0.113.1:5432/postgres", "--confirm-read-production-schema"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Refusing a connection string as an argument/);
    expect(r.stdout + r.stderr).not.toMatch(/secret/);
  });

  it("with confirmation but no SUPABASE_DB_URL, fails before connecting", () => {
    const r = run(["--confirm-read-production-schema"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SUPABASE_DB_URL is not set/);
  });

  it("does not accept both a schema file and the production flag", () => {
    const r = run(["--schema-file", SCRIPT, "--confirm-read-production-schema"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/either --schema-file or --confirm-read-production-schema/);
  });

  it("documents itself", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--confirm-read-production-schema/);
    expect(r.stdout).toMatch(/--schema-file/);
  });
});
