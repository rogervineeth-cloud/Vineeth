/**
 * The service client must authenticate as service_role even when the request
 * carries a signed-in user's session — production QA, 2026-09-23.
 *
 * A paid account with 3/3 credits generated a resume and got "You've used all
 * credits in your plan". Supabase logs for the credit debit:
 *
 *   PATCH /rest/v1/user_plans → 403   apikey: sb_secret_…
 *                                     Authorization JWT role: authenticated
 *                                     subject: the QA user
 *   postgres: permission denied for table user_plans
 *
 * createServiceClient() was built on @supabase/ssr's cookie-aware
 * createServerClient. It loaded the user's session from the request cookies
 * and sent the USER's access token as Authorization; the service key only
 * travelled as `apikey`. PostgREST takes the role from the token, so the
 * debit ran as `authenticated`, which may only SELECT user_plans.
 * consumeCredit() returned false and the route answered 402 — after the
 * Anthropic call had already been paid for.
 *
 * Every other test mocks @/lib/supabase/server wholesale, which is exactly
 * why this never surfaced. These tests run the REAL module against a real
 * @supabase/ssr session cookie and assert on the HTTP request that leaves the
 * process. Only `fetch` and `next/headers` are faked.
 */
import { createServerClient } from "@supabase/ssr";

const URL_ = "https://testref.supabase.co";
const ANON_KEY = "sb_publishable_test_anon";
const SERVICE_KEY = "sb_secret_test_service";
const USER_ID = "a0b6aa85-0000-4000-8000-000000000001";
const PLAN_ID = "bd4ac867-0000-4000-8000-000000000002";

process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;

// ── A signed-in user's session cookie, exactly as @supabase/ssr stores it ──

const b64url = (s: string) => Buffer.from(s).toString("base64url");

function userJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: USER_ID, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: "s1" })
  );
  return `${header}.${payload}.sig`;
}

const USER_TOKEN = userJwt();

function sessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: USER_TOKEN,
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "qa@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  return { name: "sb-testref-auth-token", value: "base64-" + b64url(JSON.stringify(session)) };
}

let cookieJar: { name: string; value: string }[] = [];
jest.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => cookieJar,
    set: () => {},
  }),
}));

// ── Capture what actually goes over the wire ──

type Sent = { method: string; url: string; authorization: string | null; apikey: string | null };
let sent: Sent[] = [];
let respond: (req: Sent) => { status: number; body: unknown } = () => ({ status: 200, body: [] });

beforeEach(() => {
  sent = [];
  cookieJar = [sessionCookie()];
  respond = () => ({ status: 200, body: [] });
  jest.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const req: Sent = {
      method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
      url: input instanceof Request ? input.url : String(input),
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
    };
    sent.push(req);
    const { status, body } = respond(req);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => jest.restoreAllMocks());

const restCalls = () => sent.filter((r) => r.url.includes("/rest/v1/"));

import { createServiceClient, createClient } from "@/lib/supabase/server";
import { consumeCredit } from "@/lib/plans";

// ── Reproduction ───────────────────────────────────────────────────────────

describe("reproduction — the old cookie-aware service client", () => {
  it("sent the signed-in user's token instead of the service key", async () => {
    // The previous implementation, verbatim in substance.
    const old = createServerClient(URL_, SERVICE_KEY, {
      cookies: { getAll: () => cookieJar, setAll: () => {} },
    });
    await old.from("user_plans").update({ resumes_used: 1 }).eq("id", PLAN_ID).select("id");

    const [req] = restCalls();
    expect(req.apikey).toBe(SERVICE_KEY);
    expect(req.authorization).toBe(`Bearer ${USER_TOKEN}`); // → PostgREST role: authenticated → 403
  });
});

// ── The fix ────────────────────────────────────────────────────────────────

describe("createServiceClient", () => {
  it("authenticates with the service key even when a user session cookie is present", async () => {
    const svc = await createServiceClient();
    await svc.from("user_plans").update({ resumes_used: 1 }).eq("id", PLAN_ID).select("id");

    const [req] = restCalls();
    expect(req.method).toBe("PATCH");
    expect(req.apikey).toBe(SERVICE_KEY);
    expect(req.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(req.authorization).not.toContain(USER_TOKEN);
  });

  it("never sends the user's token on any request", async () => {
    const svc = await createServiceClient();
    await svc.from("user_plans").select("*").eq("user_id", USER_ID);
    await svc.from("profiles").upsert({ user_id: USER_ID }).select("user_id");
    for (const r of sent) {
      expect(r.authorization ?? "").not.toContain(USER_TOKEN);
    }
  });

  it("does not touch the auth endpoints (no session load or refresh)", async () => {
    const svc = await createServiceClient();
    await svc.from("user_plans").select("id");
    expect(sent.filter((r) => r.url.includes("/auth/v1/"))).toEqual([]);
  });

  it("the user-scoped client still sends the user's token (unchanged)", async () => {
    const user = await createClient();
    await user.from("user_plans").select("id");
    const [req] = restCalls();
    expect(req.apikey).toBe(ANON_KEY);
    expect(req.authorization).toBe(`Bearer ${USER_TOKEN}`);
  });
});

// ── consumeCredit end to end over the real clients ────────────────────────

describe("consumeCredit", () => {
  const PLAN = {
    id: PLAN_ID,
    user_id: USER_ID,
    plan_type: "single",
    resumes_allotted: 3,
    resumes_used: 0,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    purchased_at: new Date().toISOString(),
    is_test: true,
  };

  // Emulates production grants: `authenticated` may SELECT user_plans but not
  // UPDATE it; service_role may do both.
  function productionGrants(req: Sent) {
    if (req.method === "GET") return { status: 200, body: [PLAN] };
    if (req.method === "PATCH") {
      return req.authorization === `Bearer ${SERVICE_KEY}`
        ? { status: 200, body: [{ id: PLAN_ID }] }
        : { status: 403, body: { code: "42501", message: "permission denied for table user_plans" } };
    }
    return { status: 400, body: {} };
  }

  it("debits a signed-in paid user's plan (was: 403 → false → 'used all credits')", async () => {
    respond = productionGrants;
    await expect(consumeCredit(USER_ID)).resolves.toBe(true);

    const patch = restCalls().find((r) => r.method === "PATCH")!;
    expect(patch.url).toContain(`id=eq.${PLAN_ID}`);
    expect(patch.url).toContain("resumes_used=eq.0"); // optimistic lock intact
    expect(patch.authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it("reads the plan as the user and writes it as the service role", async () => {
    respond = productionGrants;
    await consumeCredit(USER_ID);
    const get = restCalls().find((r) => r.method === "GET")!;
    const patch = restCalls().find((r) => r.method === "PATCH")!;
    expect(get.authorization).toBe(`Bearer ${USER_TOKEN}`);
    expect(patch.authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it("still returns false when the write is genuinely refused", async () => {
    respond = (req) =>
      req.method === "GET" ? { status: 200, body: [PLAN] } : { status: 403, body: { message: "permission denied" } };
    await expect(consumeCredit(USER_ID)).resolves.toBe(false);
  });

  it("returns false without writing when the user has no usable plan", async () => {
    respond = (req) => (req.method === "GET" ? { status: 200, body: [{ ...PLAN, resumes_used: 3 }] } : { status: 200, body: [] });
    await expect(consumeCredit(USER_ID)).resolves.toBe(false);
    expect(restCalls().some((r) => r.method === "PATCH")).toBe(false);
  });
});
