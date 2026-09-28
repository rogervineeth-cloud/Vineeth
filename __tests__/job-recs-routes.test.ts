/**
 * /api/job-recommendations routes, end to end through the real service,
 * scoring and fixture provider, with an in-memory store double (the SQL is
 * tested in job-recs-migration-sql.test.ts). Covers: flag off → 404, auth,
 * strict validation, honest unavailable state, fixture hard-fail in
 * production, consent, insufficient resume, idempotency, rate limiting,
 * ownership of save/dismiss, and what is (not) sent to the provider or logged.
 */
import { randomUUID } from "crypto";
import { createFakeJobRecStore } from "./helpers/fake-job-rec-store";

const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => { throw new Error("service client must not be used in these tests"); }),
}));

let mockFake = createFakeJobRecStore();
jest.mock("@/lib/job-recs/store", () => ({ supabaseJobRecStore: () => mockFake.store }));

const mockSearch = jest.fn();
jest.mock("@/lib/job-recs/providers/registry", () => {
  const actual = jest.requireActual("@/lib/job-recs/providers/registry");
  return {
    createProvider: (id: string, env: Record<string, string | undefined>) => {
      const real = actual.createProvider(id, env);
      return { id, search: async (q: unknown, o: unknown) => { mockSearch(q); return real.search(q, o); } };
    },
  };
});

import { GET, POST } from "@/app/api/job-recommendations/route";
import { POST as CONSENT } from "@/app/api/job-recommendations/consent/route";
import { PATCH } from "@/app/api/job-recommendations/[id]/route";
import { resetRateLimits } from "@/lib/job-recs/rate-limit";
import { MAX_RUNS_PER_HOUR } from "@/lib/job-recs/rate-limit";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE = {
  target_roles: ["Frontend Engineer"],
  current_city: "Bengaluru",
  profile_data: {
    email: "alice@example.com", phone: "+91 9000000001", full_name: "Alice Secretname",
    experience: [{ company: "Privateco", role: "Software Engineer", duration: "Jul 2023 - Present", location: "Bengaluru", bullets: ["Confidential bullet"] }],
    skills: ["React", "TypeScript", "CSS"],
  },
};

const ENV_KEYS = ["JOB_RECOMMENDATIONS_ENABLED", "JOB_RECOMMENDATIONS_PROVIDER", "JOB_RECOMMENDATIONS_FIXTURE_SCENARIO", "VERCEL_ENV"];
const saved: Record<string, string | undefined> = {};
const logs: string[] = [];

function req(method: string, body?: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/job-recommendations", {
    method,
    headers: body === undefined ? {} : { "content-type": contentType },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const as = (u: string | null) => mockGetUser.mockResolvedValue({ data: { user: u ? { id: u } : null } });
const create = (key = randomUUID()) => POST(req("POST", { request_key: key }));
const patch = (id: string, action: string) => PATCH(req("PATCH", { action }), { params: Promise.resolve({ id }) });
const consent = (action: string) => CONSENT(req("POST", { action }));

beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterAll(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.JOB_RECOMMENDATIONS_ENABLED = "true";
  process.env.JOB_RECOMMENDATIONS_PROVIDER = "fixture";
  mockFake = createFakeJobRecStore();
  mockFake.setProfile(ALICE, PROFILE);
  mockSearch.mockClear();
  resetRateLimits();
  as(ALICE);
  logs.length = 0;
  for (const m of ["log", "info", "warn", "error"] as const) {
    jest.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(JSON.stringify(a)); });
  }
});
afterEach(() => jest.restoreAllMocks());

describe("feature flag and authentication", () => {
  it("every route is 404 while the flag is off (the default)", async () => {
    delete process.env.JOB_RECOMMENDATIONS_ENABLED;
    expect((await GET()).status).toBe(404);
    expect((await create()).status).toBe(404);
    expect((await consent("grant")).status).toBe(404);
    expect((await patch(randomUUID(), "save")).status).toBe(404);
    expect(mockFake.calls).toEqual([]);
  });

  it("signed-out callers get 401 and nothing is read", async () => {
    as(null);
    expect((await GET()).status).toBe(401);
    expect((await create()).status).toBe(401);
    expect((await consent("grant")).status).toBe(401);
    expect((await patch(randomUUID(), "save")).status).toBe(401);
    expect(mockFake.calls).toEqual([]);
  });
});

describe("strict validation", () => {
  it.each([
    ["missing key", {}],
    ["bad uuid", { request_key: "abc" }],
    ["extra field", { request_key: randomUUID(), user_id: BOB }],
    ["array", [1]],
  ])("POST rejects %s", async (_n, body) => {
    const r = await POST(req("POST", body));
    expect(r.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("rejects non-JSON, invalid JSON and oversized bodies", async () => {
    expect((await POST(req("POST", "request_key=x", "application/x-www-form-urlencoded"))).status).toBe(400);
    expect((await POST(req("POST", "{not json"))).status).toBe(400);
    expect((await POST(req("POST", JSON.stringify({ request_key: randomUUID(), pad: "x".repeat(5000) })))).status).toBe(400);
    expect((await consent("maybe")).status).toBe(400);
    expect((await patch(randomUUID(), "apply")).status).toBe(400);
    expect((await patch("not-a-uuid", "save")).status).toBe(404);
  });
});

describe("availability", () => {
  it("no approved provider: honest unavailable state, nothing sent anywhere", async () => {
    delete process.env.JOB_RECOMMENDATIONS_PROVIDER;
    const g = await GET();
    expect(g.status).toBe(200);
    expect((await g.json()).state).toBe("unavailable");
    const p = await create();
    expect(p.status).toBe(503);
    expect((await p.json()).state).toBe("unavailable");
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockFake.calls).not.toContain("loadProfile");
  });

  it("production with no provider is unavailable too", async () => {
    delete process.env.JOB_RECOMMENDATIONS_PROVIDER;
    process.env.VERCEL_ENV = "production";
    expect((await (await GET()).json()).state).toBe("unavailable");
  });

  it("fixture in production hard-fails (500) and never produces jobs", async () => {
    process.env.VERCEL_ENV = "production";
    await consent("grant");
    const g = await GET();
    expect(g.status).toBe(500);
    expect((await g.json()).code).toBe("provider_misconfigured");
    const p = await create();
    expect(p.status).toBe(500);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockFake.runs).toHaveLength(0);
  });
});

describe("consent and resume sufficiency", () => {
  it("requires consent before any profile read or provider call", async () => {
    expect((await (await GET()).json())).toMatchObject({ state: "consent_required", consent: { granted: false } });
    const p = await create();
    expect(p.status).toBe(403);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockFake.calls).not.toContain("loadProfile");
  });

  it("insufficient resume: 422 with what is missing, no provider call", async () => {
    mockFake.setProfile(ALICE, { target_roles: [], profile_data: { skills: ["React"] } });
    await consent("grant");
    expect(await (await GET()).json()).toMatchObject({ state: "insufficient_resume", missing: ["titles", "skills"] });
    const p = await create();
    expect(p.status).toBe(422);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("a user with no profile row is insufficient, not an error", async () => {
    as(BOB);
    await consent("grant");
    expect((await (await GET()).json()).state).toBe("insufficient_resume");
  });
});

describe("creating recommendations", () => {
  beforeEach(async () => { await consent("grant"); });

  it("ready → results with persisted, explained components", async () => {
    expect((await (await GET()).json()).state).toBe("ready");
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body.state).toBe("results");
    expect(body.run.scoring_version).toBe("v1");
    const top = body.run.recommendations[0];
    expect(top.title).toBe("Frontend Engineer");
    expect(top.apply_url).toMatch(/^https:\/\//);
    expect(Object.keys(top.components).sort()).toEqual(["experience", "location", "skills", "title"]);
    expect(top.components.skills.reason).toMatch(/skills/);
    const scores = body.run.recommendations.map((x: { score: number }) => x.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((await (await GET()).json()).run.id).toBe(body.run.id);
  });

  it("the provider receives titles and skills only; logs carry no user content", async () => {
    await create();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    const q = mockSearch.mock.calls[0][0];
    expect(Object.keys(q).sort()).toEqual(["skills", "titles"]);
    const sent = JSON.stringify(q);
    for (const s of ["alice", "9000000001", "Secretname", "Privateco", "Confidential", "Bengaluru", ALICE]) expect(sent).not.toContain(s);
    const logged = logs.join("\n");
    for (const s of ["alice", "9000000001", "Secretname", "Privateco", "Confidential", "React", "Frontend", "jobs.example.com", ALICE]) {
      expect(logged).not.toContain(s);
    }
  });

  it("idempotent: the same request_key returns the same run without a second provider call", async () => {
    const key = randomUUID();
    const a = await (await create(key)).json();
    const second = await create(key);
    expect(second.status).toBe(200);
    expect((await second.json()).run.id).toBe(a.run.id);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockFake.runs).toHaveLength(1);
  });

  it("partial and empty provider results surface as those states", async () => {
    process.env.JOB_RECOMMENDATIONS_FIXTURE_SCENARIO = "partial";
    const p = await (await create()).json();
    expect(p.state).toBe("partial");
    expect(p.run.dropped_count).toBe(1);
    expect(JSON.stringify(p)).not.toContain("http://");
    process.env.JOB_RECOMMENDATIONS_FIXTURE_SCENARIO = "empty";
    expect((await (await create()).json()).state).toBe("empty");
  });

  it("provider failure is a 502 with no run stored", async () => {
    process.env.JOB_RECOMMENDATIONS_FIXTURE_SCENARIO = "error";
    const r = await create();
    expect(r.status).toBe(502);
    expect((await r.json()).code).toBe("provider_error");
    expect(mockFake.runs).toHaveLength(0);
    expect(logs.join("\n")).not.toContain("simulated failure");
  });

  it("rate limit: at most MAX_RUNS_PER_HOUR runs per rolling hour, 429 with Retry-After", async () => {
    for (let i = 0; i < MAX_RUNS_PER_HOUR; i++) {
      mockFake.advance(61_000); // stay under the per-minute burst limit's reach
      resetRateLimits();
      expect((await create()).status).toBe(201);
    }
    resetRateLimits();
    const r = await create();
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await r.json()).code).toBe("rate_limited");
    expect(mockSearch).toHaveBeenCalledTimes(MAX_RUNS_PER_HOUR);
    mockFake.advance(3_600_000);
    expect((await create()).status).toBe(201);
  });

  it("burst limit per instance also returns 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await POST(req("POST", { request_key: "bad" }))).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe("save / dismiss with ownership", () => {
  let recId = "";
  beforeEach(async () => {
    await consent("grant");
    recId = (await (await create()).json()).run.recommendations[0].id;
  });

  it("save and reset are idempotent status changes", async () => {
    expect((await patch(recId, "save")).status).toBe(200);
    expect((await patch(recId, "save")).status).toBe(200);
    expect((await (await GET()).json()).run.recommendations[0].status).toBe("saved");
    await patch(recId, "reset");
    expect((await (await GET()).json()).run.recommendations[0].status).toBe("new");
  });

  it("dismissed jobs disappear and are not suggested again; saved stay saved on refresh", async () => {
    const before = (await (await GET()).json()).run.recommendations;
    await patch(before[0].id, "dismiss");
    await patch(before[1].id, "save");
    const after = (await (await GET()).json()).run.recommendations;
    expect(after.map((r: { id: string }) => r.id)).not.toContain(before[0].id);
    const next = (await (await create()).json()).run.recommendations;
    expect(next.map((r: { title: string }) => r.title)).not.toContain(before[0].title);
    expect(next.find((r: { title: string }) => r.title === before[1].title).status).toBe("saved");
  });

  it("another user cannot save, dismiss or read someone else's recommendation", async () => {
    as(BOB);
    await consent("grant");
    expect((await patch(recId, "dismiss")).status).toBe(404);
    expect((await (await GET()).json()).run).toBeUndefined();
    as(ALICE);
    expect((await (await GET()).json()).run.recommendations[0].id).toBe(recId);
  });

  it("withdrawing consent deletes the user's runs and recommendations", async () => {
    const r = await consent("revoke");
    expect((await r.json()).state).toBe("consent_required");
    expect(mockFake.runs).toHaveLength(0);
    expect(mockFake.recs).toHaveLength(0);
  });
});
