/**
 * Release blocker: a resume generated with a plan's LAST credit could not be
 * downloaded. canDownloadResume allowed a download only with an active plan
 * that still had a credit left, or a previous download — so every Single
 * purchase (1 credit) generated a resume and then got 402 on its first
 * download. The preview page applied the same rule and showed the upgrade
 * modal instead of the Download button.
 *
 * The fix keeps ownership as the first gate (a resume that is not the
 * caller's, or does not exist, is 404 whatever their plan) and then entitles
 * a resume created while the user held a plan, even if that plan is now
 * exhausted or expired. See lib/download-entitlement.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";
import { resumeDownloadAllowed, type DownloadPlan } from "@/lib/download-entitlement";

// ── Fake Supabase with RLS: a user only ever sees their own rows ───────────
type Row = Record<string, unknown>;
const db: { user: { id: string } | null; resumes: Row[]; user_plans: Row[]; profiles: Row[]; updates: Row[] } = {
  user: null, resumes: [], user_plans: [], profiles: [], updates: [],
};

function query(table: "resumes" | "user_plans" | "profiles") {
  const filters: [string, unknown][] = [];
  const after: [string, string][] = [];
  let update: Row | null = null;
  const rows = () =>
    db[table]
      .filter((r) => db.user && r.user_id === db.user.id) // RLS: own rows only
      .filter((r) => filters.every(([c, v]) => r[c] === v))
      .filter((r) => after.every(([c, v]) => String(r[c]) > v));
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
    gt: (c: string, v: string) => { after.push([c, v]); return q; },
    order: () => q,
    limit: () => q,
    update: (vals: Row) => { update = vals; return q; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => {
      const r = rows();
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: "not one row" } };
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (update) {
        for (const r of rows()) db.updates.push({ table, id: r.id, ...update });
      }
      return Promise.resolve({ data: rows(), error: null }).then(resolve);
    },
  };
  return q;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (t: "resumes" | "user_plans" | "profiles") => query(t),
  })),
  createServiceClient: jest.fn(async () => ({})),
}));

const mockRender = jest.fn(async () => new Uint8Array([37, 80, 68, 70]));
jest.mock("@/lib/resume-pdf", () => ({ renderResumePdf: (...a: unknown[]) => mockRender(...(a as [])) }));

import { GET as downloadPdf } from "@/app/api/download-pdf/[id]/route";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RESUME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T0 = "2026-09-27T06:00:00.000Z";           // plan purchased
const T1 = "2026-09-27T06:05:00.000Z";           // resume generated
const LATER = "2026-10-27T00:00:00.000Z";

const plan = (over: Partial<DownloadPlan & { user_id: string }> = {}) => ({
  user_id: OWNER, resumes_used: 1, resumes_allotted: 1, purchased_at: T0, expires_at: "2027-09-27T06:00:00.000Z", ...over,
});
const resume = (over: Row = {}) => ({
  id: RESUME, user_id: OWNER, created_at: T1, downloaded_at: null, template: "classic",
  resume_json: { summary: "Fictional QA summary", tailored_role: "QA Engineer", experience: [], skills: [], education: [], projects: [] },
  contact_snapshot: { full_name: "Aarav Menon", email: "aarav@example.com", phone: "", current_city: "" },
  ...over,
});
const call = (id = RESUME) =>
  downloadPdf(new Request(`http://localhost/api/download-pdf/${id}`) as unknown as NextRequest, { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.user = { id: OWNER };
  db.resumes = [resume()];
  db.user_plans = [];
  db.profiles = [];
  db.updates = [];
  mockRender.mockClear();
});

// ── The rule ───────────────────────────────────────────────────────────────
describe("resumeDownloadAllowed", () => {
  const r = { created_at: T1, downloaded_at: null };
  const now = new Date("2026-09-27T07:00:00.000Z");

  it("Single plan, its only credit used by this resume → first download allowed", () => {
    expect(resumeDownloadAllowed(r, [plan()], now)).toBe(true);
  });
  it("active plan with credits left → allowed (unchanged)", () => {
    expect(resumeDownloadAllowed(r, [plan({ resumes_allotted: 3 })], now)).toBe(true);
  });
  it("already downloaded → allowed with no plan at all (unchanged)", () => {
    expect(resumeDownloadAllowed({ ...r, downloaded_at: T1 }, [], now)).toBe(true);
  });
  it("plan exhausted AND since expired → still allowed for a resume made under it", () => {
    expect(resumeDownloadAllowed(r, [plan({ expires_at: "2026-09-27T06:30:00.000Z" })], new Date(LATER))).toBe(true);
  });
  it("NULL resumes_used is treated as 0", () => {
    expect(resumeDownloadAllowed(r, [plan({ resumes_used: null, purchased_at: LATER })], now)).toBe(true);
  });
  it("no plan ever, never downloaded → denied", () => {
    expect(resumeDownloadAllowed(r, [], now)).toBe(false);
  });
  it("resume created BEFORE the only (exhausted) plan was bought → denied", () => {
    expect(resumeDownloadAllowed({ ...r, created_at: "2026-09-01T00:00:00.000Z" }, [plan()], now)).toBe(false);
  });
  it("unparseable dates never grant", () => {
    expect(resumeDownloadAllowed({ ...r, created_at: "garbage" }, [plan()], now)).toBe(false);
    expect(resumeDownloadAllowed(r, [plan({ purchased_at: null })], now)).toBe(false);
  });
});

// ── The route ──────────────────────────────────────────────────────────────
describe("GET /api/download-pdf/[id]", () => {
  it("owner, Single plan 1/1 used by this resume, first download → 200 PDF and marked downloaded", async () => {
    db.user_plans = [plan()];
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(mockRender).toHaveBeenCalledTimes(1);
    await new Promise((r) => setImmediate(r));
    expect(db.updates).toEqual([expect.objectContaining({ table: "resumes", id: RESUME, downloaded_at: expect.any(String) })]);
  });

  it("owner with no plan ever and not downloaded → 402, nothing rendered", async () => {
    const res = await call();
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("PAYMENT_REQUIRED");
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("non-owner with no active credit → 404, nothing rendered or marked", async () => {
    db.user = { id: OTHER };
    db.user_plans = [plan({ user_id: OTHER, purchased_at: T0 })]; // exhausted, bought before the owner's resume
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("non-owner WITH active credits → still 404", async () => {
    db.user = { id: OTHER };
    db.user_plans = [plan({ user_id: OTHER, resumes_used: 0, resumes_allotted: 5 })];
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("the owner's plan does not entitle anyone else", async () => {
    db.user_plans = [plan({ resumes_used: 0, resumes_allotted: 5 })]; // OWNER's
    db.user = { id: OTHER };
    expect((await call()).status).toBe(404);
  });

  it("unknown resume id, no active credit → 404", async () => {
    db.user_plans = [plan()];
    const res = await call("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(res.status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("signed out → 401 before any lookup", async () => {
    db.user = null;
    expect((await call()).status).toBe(401);
    expect(mockRender).not.toHaveBeenCalled();
  });
});

// ── The preview page applies the same rule (Jest has no DOM; read the source) ─
describe("preview page download gate", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "(app)", "preview", "[id]", "page.tsx"), "utf8");
  it("uses resumeDownloadAllowed and loads every plan with purchased_at", () => {
    expect(src).toMatch(/setCanDownload\(resumeDownloadAllowed\(r, plansRes\.data \?\? \[\]\)\)/);
    const plansQuery = src.slice(src.indexOf('from("user_plans")'), src.indexOf('from("user_plans")') + 200);
    expect(plansQuery).toMatch(/purchased_at/);
    expect(plansQuery).not.toMatch(/expires_at", new Date/);
  });
});
