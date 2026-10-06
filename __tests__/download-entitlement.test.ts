/**
 * PDF downloads (migration 018): only a resume covered by a PAID credit — a
 * resume_entitlements row — can be downloaded. The free AI resume preview has
 * none and can never be downloaded unless one paid credit is spent on it via
 * POST /api/resumes/[id]/unlock (once; repeats and concurrent unlocks are
 * free). The download route itself never spends a credit.
 *
 * Removed paths (each tested below as now refused): "downloaded once →
 * re-downloads free", "any active plan → any resume", "a plan was held when
 * the resume was created".
 *
 * Invariant: N downloads of an entitled resume = 0 extra credits; unlocking a
 * free preview = exactly 1 paid credit, ever.
 */
import { NextRequest } from "next/server";
import { downloadAction, paidCreditsLeft, freeCreditsLeft, type CreditPlan } from "@/lib/download-entitlement";

// ── Fake Supabase with RLS (own rows only; the service client bypasses) ───
type Row = Record<string, unknown>;
type Table = "resumes" | "user_plans" | "profiles" | "resume_entitlements";
const db: { user: { id: string } | null; resumes: Row[]; user_plans: Row[]; profiles: Row[]; resume_entitlements: Row[]; updates: Row[]; planReads: number } = {
  user: null, resumes: [], user_plans: [], profiles: [], resume_entitlements: [], updates: [], planReads: 0,
};

function query(table: Table, service = false) {
  const filters: [string, unknown][] = [];
  let update: Row | null = null;
  if (table === "user_plans") db.planReads++;
  const rows = () => db[table]
    .filter((r) => service || (db.user && r.user_id === db.user.id))
    .filter((r) => filters.every(([c, v]) => r[c] === v));
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
    update: (vals: Row) => { update = vals; return q; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => { const r = rows(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: "not one row" } }; },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (update) for (const r of rows()) db.updates.push({ table, id: r.id, service, ...update });
      return Promise.resolve({ data: rows(), error: null }).then(resolve);
    },
  };
  return q;
}

// unlock_resume_download, as migration 018 defines it (serialised like the row locks).
let rpcLock: Promise<unknown> = Promise.resolve();
function unlockRpc(userId: string, resumeId: string) {
  const run = () => {
    const resume = db.resumes.find((r) => r.id === resumeId && r.user_id === userId);
    if (!resume) return { outcome: "not_found", plan_id: null };
    if (db.resume_entitlements.some((e) => e.resume_id === resumeId)) return { outcome: "already_entitled", plan_id: null };
    const plan = db.user_plans
      .filter((p) => p.user_id === userId && p.plan_type !== "beta" && Date.parse(String(p.expires_at)) > Date.now() && Number(p.resumes_used) < Number(p.resumes_allotted))
      .sort((a, b) => String(b.purchased_at).localeCompare(String(a.purchased_at)))[0];
    if (!plan) return { outcome: "payment_required", plan_id: null };
    plan.resumes_used = Number(plan.resumes_used) + 1;
    db.resume_entitlements.push({ resume_id: resumeId, user_id: userId, plan_id: plan.id, source: "unlock" });
    return { outcome: "unlocked", plan_id: plan.id };
  };
  const next = rpcLock.then(run);
  rpcLock = next.catch(() => undefined);
  return next;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (t: Table) => query(t),
  })),
  createServiceClient: jest.fn(async () => ({
    from: (t: Table) => query(t, true),
    rpc: async (fn: string, args: { p_user_id: string; p_resume_id: string }) => {
      if (fn !== "unlock_resume_download") throw new Error(`unexpected rpc ${fn}`);
      return { data: [await unlockRpc(args.p_user_id, args.p_resume_id)], error: null };
    },
  })),
}));

const mockRender = jest.fn(async () => new Uint8Array([37, 80, 68, 70]));
jest.mock("@/lib/resume-pdf", () => ({ renderResumePdf: (...a: unknown[]) => mockRender(...(a as [])) }));

import { GET as downloadPdf } from "@/app/api/download-pdf/[id]/route";
import { POST as unlock } from "@/app/api/resumes/[id]/unlock/route";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FREE_RESUME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAID_RESUME = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const YEAR = "2099-01-01T00:00:00.000Z";

const resume = (id: string, over: Row = {}) => ({
  id, user_id: OWNER, created_at: "2026-10-01T06:05:00.000Z", downloaded_at: null, template: "classic",
  resume_json: { summary: "Fictional QA summary", tailored_role: "QA Engineer", experience: [], skills: [], education: [], projects: [] },
  contact_snapshot: { full_name: "Aarav Menon", email: "aarav@example.com", phone: "", current_city: "" },
  ...over,
});
const plan = (over: Row) => ({ id: `plan-${Math.random()}`, user_id: OWNER, resumes_used: 0, resumes_allotted: 1, purchased_at: "2026-09-01T00:00:00.000Z", expires_at: YEAR, ...over });
const download = (id: string, query = "") => downloadPdf(new Request(`http://localhost/api/download-pdf/${id}${query}`) as unknown as NextRequest, { params: Promise.resolve({ id }) });
const renderedStyle = (call = 0) => (mockRender.mock.calls[call] as unknown[])[2];
const doUnlock = (id: string) => unlock(new Request(`http://localhost/api/resumes/${id}/unlock`, { method: "POST" }) as unknown as NextRequest, { params: Promise.resolve({ id }) });
const credits = () => db.user_plans.filter((p) => p.plan_type !== "beta").map((p) => `${p.plan_type}:${p.resumes_used}/${p.resumes_allotted}`).join(",");

beforeEach(() => {
  db.user = { id: OWNER };
  db.resumes = [resume(FREE_RESUME), resume(PAID_RESUME)];
  // The free preview credit used on FREE_RESUME; PAID_RESUME generated with a paid credit.
  db.user_plans = [plan({ plan_type: "beta", resumes_used: 1 }), plan({ plan_type: "fresher", resumes_allotted: 5, resumes_used: 1 })];
  db.resume_entitlements = [{ resume_id: PAID_RESUME, user_id: OWNER, plan_id: "p", source: "generation" }];
  db.profiles = [];
  db.updates = [];
  db.planReads = 0;
  mockRender.mockClear();
});

describe("download rule (lib/download-entitlement.ts)", () => {
  it("entitled → download; not entitled → unlock if a PAID credit is left, else upgrade", () => {
    expect(downloadAction(true, 0)).toBe("download");
    expect(downloadAction(false, 3)).toBe("unlock");
    expect(downloadAction(false, 0)).toBe("upgrade");
  });
  it("the free preview credit never counts as a paid credit", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const plans: CreditPlan[] = [
      { plan_type: "beta", resumes_allotted: 1, resumes_used: 0, expires_at: YEAR },
      { plan_type: "single", resumes_allotted: 1, resumes_used: 0, expires_at: "2026-01-01T00:00:00Z" }, // expired
    ];
    expect(paidCreditsLeft(plans, now)).toBe(0);
    expect(freeCreditsLeft(plans, now)).toBe(1);
    expect(paidCreditsLeft([...plans, { plan_type: "fresher", resumes_allotted: 5, resumes_used: 2, expires_at: YEAR }], now)).toBe(3);
  });
});

describe("GET /api/download-pdf/[id] (direct API and the dashboard button use this)", () => {
  it("a free preview is refused (402) even though the user holds paid credits — downloads never spend credits", async () => {
    const res = await download(FREE_RESUME);
    expect(res.status).toBe(402);
    expect((await res.json()).message).toBe("This resume's PDF isn't unlocked. Spend 1 paid credit to unlock it — once; downloading again is free.");
    expect(mockRender).not.toHaveBeenCalled();
    expect(credits()).toBe("fresher:1/5");
  });

  it("the old 'already downloaded → free re-download' path is gone", async () => {
    db.resumes = [resume(FREE_RESUME, { downloaded_at: "2026-10-01T07:00:00.000Z" })];
    expect((await download(FREE_RESUME)).status).toBe(402);
  });

  it("a paid resume downloads, and repeat downloads are free (no credit read or spent)", async () => {
    for (let i = 0; i < 3; i++) expect((await download(PAID_RESUME)).status).toBe(200);
    expect(mockRender).toHaveBeenCalledTimes(3);
    expect(credits()).toBe("fresher:1/5");
    expect(db.planReads).toBe(0);
  });

  it("non-owner → 404 even with an entitlement on their own account; unknown → 404; signed out → 401", async () => {
    db.user = { id: OTHER };
    expect((await download(PAID_RESUME)).status).toBe(404);
    db.user = { id: OWNER };
    expect((await download("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).status).toBe(404);
    db.user = null;
    expect((await download(PAID_RESUME)).status).toBe(401);
    expect(mockRender).not.toHaveBeenCalled();
  });
});

describe("GET /api/download-pdf/[id]?style= (PDF style picked on the preview page)", () => {
  it("renders the saved style by default, and an offered ?style= for that download only", async () => {
    db.resumes = [resume(PAID_RESUME, { template: "modern" })];
    expect((await download(PAID_RESUME)).status).toBe(200);
    expect(renderedStyle(0)).toBe("modern");
    expect((await download(PAID_RESUME, "?style=compact")).status).toBe(200);
    expect(renderedStyle(1)).toBe("compact");
    // Nothing about the style is written back; the only write is downloaded_at.
    expect(db.updates.every((u) => Object.keys(u).sort().join() === "downloaded_at,id,service,table")).toBe(true);
    expect(db.resumes[0].template).toBe("modern");
  });

  it("a retired or unknown ?style= renders the saved style; a saved Executive keeps rendering", async () => {
    db.resumes = [resume(PAID_RESUME, { template: "executive" })];
    await download(PAID_RESUME, "?style=fancy");
    await download(PAID_RESUME);
    expect([renderedStyle(0), renderedStyle(1)]).toEqual(["executive", "executive"]);
    db.resumes = [resume(PAID_RESUME, { template: null })];
    await download(PAID_RESUME, "?style=executive");
    expect(renderedStyle(2)).toBeNull(); // null renders Classic
  });

  it("a style never bypasses the entitlement and never costs a credit", async () => {
    const res = await download(FREE_RESUME, "?style=modern");
    expect(res.status).toBe(402);
    expect(mockRender).not.toHaveBeenCalled();
    for (const s of ["classic", "modern", "compact"]) expect((await download(PAID_RESUME, `?style=${s}`)).status).toBe(200);
    expect(credits()).toBe("fresher:1/5");
    expect(db.planReads).toBe(0);
  });
});

describe("POST /api/resumes/[id]/unlock", () => {
  it("spends exactly one PAID credit on a free preview, once; then it downloads; repeats are free", async () => {
    const r1 = await doUnlock(FREE_RESUME);
    expect(await r1.json()).toEqual({ status: "unlocked" });
    expect(credits()).toBe("fresher:2/5");
    expect((await doUnlock(FREE_RESUME)).status).toBe(200);
    expect(credits()).toBe("fresher:2/5");
    for (let i = 0; i < 2; i++) expect((await download(FREE_RESUME)).status).toBe(200);
    expect(credits()).toBe("fresher:2/5");
  });

  it("concurrent unlocks of the same resume charge once", async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => doUnlock(FREE_RESUME)));
    const statuses = await Promise.all(res.map((r) => r.json()));
    expect(statuses.filter((s) => s.status === "unlocked")).toHaveLength(1);
    expect(statuses.filter((s) => s.status === "already_entitled")).toHaveLength(4);
    expect(credits()).toBe("fresher:2/5");
  });

  it("an already-paid resume is never charged by unlock", async () => {
    expect(await (await doUnlock(PAID_RESUME)).json()).toEqual({ status: "already_entitled" });
    expect(credits()).toBe("fresher:1/5");
  });

  it("with only the free preview credit (no paid credit): 402, nothing unlocked", async () => {
    db.user_plans = [plan({ plan_type: "beta", resumes_used: 0 })];
    const res = await doUnlock(FREE_RESUME);
    expect(res.status).toBe(402);
    expect((await res.json()).message).toBe("Unlocking this resume's PDF costs 1 paid credit, and you have none left.");
    expect(db.resume_entitlements.some((e) => e.resume_id === FREE_RESUME)).toBe(false);
    expect((await download(FREE_RESUME)).status).toBe(402);
  });

  it("another user's resume → 404, no charge; signed out → 401; malformed id → 404", async () => {
    db.user = { id: OTHER };
    db.user_plans.push(plan({ user_id: OTHER, plan_type: "career", resumes_allotted: 25 }));
    expect((await doUnlock(FREE_RESUME)).status).toBe(404);
    expect(db.user_plans.find((p) => p.user_id === OTHER)!.resumes_used).toBe(0);
    db.user = null;
    expect((await doUnlock(FREE_RESUME)).status).toBe(401);
    db.user = { id: OWNER };
    expect((await doUnlock("not-a-uuid")).status).toBe(404);
  });
});
