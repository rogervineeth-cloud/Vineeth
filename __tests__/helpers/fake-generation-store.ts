/**
 * In-memory GenerationStore for route tests. Mirrors migrations 013 + 018
 * (tested against a real PostgreSQL in generation-idempotency-sql.test.ts and
 * migration-018-sql.test.ts):
 *   - UNIQUE (user_id, request_key): one attempt, one outcome;
 *   - one PENDING attempt per (user_id, fingerprint);
 *   - begin() RESERVES one credit before the model (serialised per store —
 *     the SQL serialises per user): the single free 'beta' credit FIRST,
 *     then paid plans (newest purchase); none -> payment_required;
 *   - fail() releases the reservation; complete() keeps it, saves the resume
 *     and records a download entitlement only for a PAID credit (or creator).
 */
import { randomUUID } from "crypto";
import type { GenerationStore, GeneratedResumeRow, BeginOutcome, CompleteOutcome, StoredResume } from "@/lib/generation-idempotency";

type Attempt = {
  userId: string; key: string; fingerprint: string; status: "pending" | "completed" | "failed";
  resumeId: string | null; reservedPlanId: string | null; failure?: string;
};
export type FakePlan = { id: string; userId: string; planType: string; allotted: number; used: number; purchasedAt: number };

export type FakeGenerationStore = GenerationStore & {
  attempts: Attempt[];
  plans: FakePlan[];
  resumes: { id: string; userId: string; requestKey: string; row: GeneratedResumeRow }[];
  entitlements: Set<string>;
  /** Plan types of the credits actually spent (completed attempts that held a reservation). */
  readonly charges: string[];
  /** Model calls the route was allowed to start (begin -> started). */
  started: number;
  addPlan(userId: string, planType: string, allotted: number): FakePlan;
  reset(): void;
};

export function createFakeGenerationStore(): FakeGenerationStore {
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => T): Promise<T> => {
    const next = lock.then(fn);
    lock = next.catch(() => undefined);
    return next;
  };
  let clock = 0;
  const find = (userId: string, key: string) => store.attempts.find((a) => a.userId === userId && a.key === key);
  const release = (a: Attempt) => {
    if (!a.reservedPlanId) return;
    const p = store.plans.find((x) => x.id === a.reservedPlanId);
    if (p) p.used = Math.max(0, p.used - 1);
    a.reservedPlanId = null;
  };

  const store: FakeGenerationStore = {
    attempts: [], plans: [], resumes: [], entitlements: new Set(), started: 0,
    get charges() {
      return store.attempts.filter((a) => a.status === "completed" && a.reservedPlanId)
        .map((a) => store.plans.find((p) => p.id === a.reservedPlanId)!.planType);
    },
    addPlan(userId, planType, allotted) {
      const p = { id: randomUUID(), userId, planType, allotted, used: 0, purchasedAt: ++clock };
      store.plans.push(p);
      return p;
    },
    reset() {
      store.attempts = []; store.plans = []; store.resumes = []; store.entitlements = new Set(); store.started = 0;
    },
    begin(userId, key, fingerprint, charge): Promise<BeginOutcome> {
      return serial((): BeginOutcome => {
        let a = find(userId, key);
        const identicalPending = () => store.attempts.some((x) => x.userId === userId && x.fingerprint === fingerprint && x.status === "pending" && x.key !== key);
        if (a) {
          if (a.fingerprint !== fingerprint) return { outcome: "key_reused" };
          if (a.status === "completed") return { outcome: "replay", resumeId: a.resumeId! };
          if (a.status === "pending" || identicalPending()) return { outcome: "in_progress" };
          a.status = "pending";
          a.failure = undefined;
        } else {
          if (identicalPending()) return { outcome: "in_progress" };
          a = { userId, key, fingerprint, status: "pending", resumeId: null, reservedPlanId: null };
          store.attempts.push(a);
        }
        if (!charge) { store.started++; return { outcome: "started", planType: null }; }
        const plan = store.plans
          .filter((p) => p.userId === userId && p.used < p.allotted)
          .sort((x, y) => Number(y.planType === "beta") - Number(x.planType === "beta") || y.purchasedAt - x.purchasedAt)[0];
        if (!plan) { a.status = "failed"; a.failure = "credits_exhausted"; return { outcome: "payment_required" }; }
        plan.used++;
        a.reservedPlanId = plan.id;
        store.started++;
        return { outcome: "started", planType: plan.planType };
      });
    },
    complete(userId, key, row, isCreator): Promise<CompleteOutcome> {
      return serial((): CompleteOutcome => {
        const a = find(userId, key);
        if (!a) return { outcome: "unknown_request" };
        if (a.status === "completed") return { outcome: "replay", resumeId: a.resumeId!, entitled: store.entitlements.has(a.resumeId!) };
        if (a.status !== "pending") return { outcome: "expired" };
        const id = randomUUID();
        store.resumes.push({ id, userId, requestKey: key, row });
        const plan = a.reservedPlanId ? store.plans.find((p) => p.id === a.reservedPlanId) : null;
        const entitled = plan ? plan.planType !== "beta" : !!isCreator;
        if (entitled) store.entitlements.add(id);
        a.status = "completed";
        a.resumeId = id;
        return { outcome: "completed", resumeId: id, entitled };
      });
    },
    fail(userId, key, reason) {
      return serial(() => {
        const a = find(userId, key);
        if (a && a.status === "pending") { release(a); a.status = "failed"; a.failure = reason; }
      });
    },
    async load(userId, resumeId): Promise<StoredResume | null> {
      const r = store.resumes.find((x) => x.id === resumeId && x.userId === userId);
      return r ? { id: r.id, resume_json: r.row.resume_json, regen_of_resume_id: r.row.regen_of_resume_id, entitled: store.entitlements.has(r.id) } : null;
    },
  };
  return store;
}
