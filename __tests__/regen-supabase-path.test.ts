/**
 * canGenerateFreeRegen over the real Supabase client — production QA,
 * 2026-09-24.
 *
 * A same-JD regeneration after #36 was still charged, which looked like the
 * server rejecting a valid case. It was not: the API logs show the server
 * never queried `resumes` at all during that generation, and the new row's
 * regen_of_resume_id is NULL — the parent id never reached the API (a
 * client read-timing bug, covered in free-regeneration.test.ts).
 *
 * This suite closes the other half of the question — "does the real database
 * path agree with the in-memory test?" — by running the REAL
 * canGenerateFreeRegen through the REAL @supabase/ssr client with a signed-in
 * session cookie. Only `fetch` is faked, answering the way PostgREST does:
 * JSON arrays, Postgres-format timestamps (microseconds, +00:00), and the
 * production JD shape (2 775 chars, multi-line).
 */
const URL_ = "https://testref.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test_anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test_service";

const USER_ID = "a0b6aa85-9768-4b40-b8d8-e80e6b57f2a3";
const PARENT = "dc25fa97-77a6-4ceb-9761-16429dccec2c";

// ── Signed-in session cookie, as @supabase/ssr stores it ──
const b64url = (s: string) => Buffer.from(s).toString("base64url");
function sessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const jwt = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: USER_ID, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })),
    "sig",
  ].join(".");
  const session = {
    access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "qa@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  return { name: "sb-testref-auth-token", value: "base64-" + b64url(JSON.stringify(session)) };
}
jest.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [sessionCookie()], set: () => {} }),
}));

// ── A PostgREST-shaped `resumes` endpoint ──
type Row = { id: string; user_id: string; jd_text: string; created_at: string; regen_of_resume_id: string | null };
let table: Row[] = [];
let requests: URL[] = [];

/** Postgres timestamptz as PostgREST serialises it: 2026-09-23T14:02:04.24453+00:00 */
function pgTimestamp(msAgo: number): string {
  const d = new Date(Date.now() - msAgo);
  return d.toISOString().replace(/\.(\d{3})Z$/, (_m, ms) => `.${ms}53+00:00`);
}

beforeEach(() => {
  table = [];
  requests = [];
  jest.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    if (!url.pathname.startsWith("/rest/v1/resumes")) return new Response("[]", { status: 200 });
    const eq = (col: string) => url.searchParams.get(col)?.replace(/^eq\./, "");
    const cols = (url.searchParams.get("select") ?? "*").split(",");
    const rows = table
      .filter((r) => (!eq("id") || r.id === eq("id")) && (!eq("user_id") || r.user_id === eq("user_id")))
      .map((r) => (cols[0] === "*" ? r : Object.fromEntries(cols.map((c) => [c, (r as Record<string, unknown>)[c]]))));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => jest.restoreAllMocks());

import { canGenerateFreeRegen } from "@/lib/plans";

// A multi-line JD of the production length.
const JD = (
  "Software Engineer — Bengaluru\n\nAbout the role\nWe are hiring a Software Engineer to build TypeScript " +
  "and Node.js services on AWS.\n\nResponsibilities\n• Design REST APIs\n• Work with PostgreSQL\n• Write tests\n\n"
).padEnd(2775, "Requirements: collaborate with the team and ship reliable software. ");

const HOUR = 3_600_000;

describe("canGenerateFreeRegen — real Supabase client, PostgREST-shaped responses", () => {
  it("production case: parent 13 h old, identical 2 775-char JD → free", async () => {
    expect(JD.length).toBe(2775);
    table = [{ id: PARENT, user_id: USER_ID, jd_text: JD, created_at: pgTimestamp(13 * HOUR), regen_of_resume_id: null }];
    await expect(canGenerateFreeRegen(USER_ID, PARENT, JD)).resolves.toBe(true);
  });

  it("queries exactly the columns and filters the lineage walk needs", async () => {
    table = [{ id: PARENT, user_id: USER_ID, jd_text: JD, created_at: pgTimestamp(HOUR), regen_of_resume_id: null }];
    await canGenerateFreeRegen(USER_ID, PARENT, JD);
    const q = requests.find((u) => u.pathname === "/rest/v1/resumes")!;
    expect(q.searchParams.get("select")).toBe("id,jd_text,created_at,regen_of_resume_id");
    expect(q.searchParams.get("id")).toBe(`eq.${PARENT}`);
    expect(q.searchParams.get("user_id")).toBe(`eq.${USER_ID}`);
  });

  it("the browser's JD with \\r\\n line endings still matches the stored JD", async () => {
    table = [{ id: PARENT, user_id: USER_ID, jd_text: JD, created_at: pgTimestamp(HOUR), regen_of_resume_id: null }];
    await expect(canGenerateFreeRegen(USER_ID, PARENT, JD.replace(/\n/g, "\r\n"))).resolves.toBe(true);
  });

  it("Postgres timestamps are honoured at the 24 h edge", async () => {
    table = [{ id: PARENT, user_id: USER_ID, jd_text: JD, created_at: pgTimestamp(24 * HOUR + 60_000), regen_of_resume_id: null }];
    await expect(canGenerateFreeRegen(USER_ID, PARENT, JD)).resolves.toBe(false);
    table[0].created_at = pgTimestamp(24 * HOUR - 60_000);
    await expect(canGenerateFreeRegen(USER_ID, PARENT, JD)).resolves.toBe(true);
  });

  it("walks lineage through real queries: regen of a regen anchors to the paid original", async () => {
    const CHILD = "19aa88e2-da2b-45cd-a601-16a7b39f39ad";
    table = [
      { id: PARENT, user_id: USER_ID, jd_text: JD, created_at: pgTimestamp(25 * HOUR), regen_of_resume_id: null },
      { id: CHILD, user_id: USER_ID, jd_text: JD, created_at: pgTimestamp(1 * HOUR), regen_of_resume_id: PARENT },
    ];
    await expect(canGenerateFreeRegen(USER_ID, CHILD, JD)).resolves.toBe(false);
    expect(requests.filter((u) => u.pathname === "/rest/v1/resumes").map((u) => u.searchParams.get("id"))).toEqual([
      `eq.${CHILD}`,
      `eq.${PARENT}`,
    ]);
  });

  it("another user's parent returns no row → not free", async () => {
    table = [{ id: PARENT, user_id: "someone-else", jd_text: JD, created_at: pgTimestamp(HOUR), regen_of_resume_id: null }];
    await expect(canGenerateFreeRegen(USER_ID, PARENT, JD)).resolves.toBe(false);
  });
});
