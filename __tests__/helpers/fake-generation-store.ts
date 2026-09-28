/**
 * In-memory GenerationStore for route tests. Mirrors the outcomes and rules
 * of migration 013's SQL functions (which are themselves tested against a real
 * PostgreSQL in generation-idempotency-sql.test.ts):
 *   - UNIQUE (user_id, request_key): one attempt, one outcome;
 *   - one PENDING attempt per (user_id, fingerprint);
 *   - complete() is serialised per attempt (the row lock) and charges,
 *     inserts and marks done together — or does none of them.
 */
import { randomUUID } from "crypto";
import type { GenerationStore, GeneratedResumeRow, BeginOutcome, CompleteOutcome, StoredResume } from "@/lib/generation-idempotency";

type Attempt = { userId: string; key: string; fingerprint: string; status: "pending" | "completed" | "failed"; resumeId: string | null; charged: boolean; failure?: string };

export type FakeGenerationStore = GenerationStore & {
  attempts: Attempt[];
  resumes: { id: string; userId: string; requestKey: string; row: GeneratedResumeRow }[];
  charges: string[];
  reset(): void;
};

export function createFakeGenerationStore(opts: { charge?: (userId: string) => Promise<boolean> } = {}): FakeGenerationStore {
  const locks = new Map<string, Promise<CompleteOutcome>>();
  const find = (userId: string, key: string) => store.attempts.find((a) => a.userId === userId && a.key === key);

  const store: FakeGenerationStore = {
    attempts: [],
    resumes: [],
    charges: [],
    reset() {
      store.attempts = [];
      store.resumes = [];
      store.charges = [];
      locks.clear();
    },
    async begin(userId, key, fingerprint): Promise<BeginOutcome> {
      const existing = find(userId, key);
      const identicalPending = () => store.attempts.some((a) => a.userId === userId && a.fingerprint === fingerprint && a.status === "pending" && a.key !== key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { outcome: "key_reused" };
        if (existing.status === "completed") return { outcome: "replay", resumeId: existing.resumeId! };
        if (existing.status === "pending") return { outcome: "in_progress" };
        if (identicalPending()) return { outcome: "in_progress" };
        existing.status = "pending";
        existing.failure = undefined;
        return { outcome: "started" };
      }
      if (identicalPending()) return { outcome: "in_progress" };
      store.attempts.push({ userId, key, fingerprint, status: "pending", resumeId: null, charged: false });
      return { outcome: "started" };
    },
    complete(userId, key, charge, row) {
      const lockKey = `${userId}:${key}`;
      const prev = locks.get(lockKey) ?? Promise.resolve(null as unknown as CompleteOutcome);
      const next = prev.then(async (): Promise<CompleteOutcome> => {
        const a = find(userId, key);
        if (!a) return { outcome: "unknown_request" };
        if (a.status === "completed") return { outcome: "replay", resumeId: a.resumeId! };
        if (a.status !== "pending") return { outcome: "expired" };
        if (charge) {
          const ok = await (opts.charge ?? (async () => true))(userId);
          if (!ok) { a.status = "failed"; a.failure = "credits_exhausted"; return { outcome: "payment_required" }; }
          store.charges.push(userId);
        }
        const id = randomUUID();
        store.resumes.push({ id, userId, requestKey: key, row });
        a.status = "completed";
        a.resumeId = id;
        a.charged = charge;
        return { outcome: "completed", resumeId: id };
      });
      locks.set(lockKey, next.catch(() => null as unknown as CompleteOutcome));
      return next;
    },
    async fail(userId, key, reason) {
      const a = find(userId, key);
      if (a && a.status === "pending") { a.status = "failed"; a.failure = reason; }
    },
    async load(userId, resumeId): Promise<StoredResume | null> {
      const r = store.resumes.find((x) => x.id === resumeId && x.userId === userId);
      return r ? { id: r.id, resume_json: r.row.resume_json, regen_of_resume_id: r.row.regen_of_resume_id } : null;
    },
  };
  return store;
}
