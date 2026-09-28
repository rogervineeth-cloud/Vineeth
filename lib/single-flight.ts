// One generation at a time per page.
//
// The Generate button was disabled via React state (`generating`), which only
// takes effect on the next render. Two clicks in the same frame — a double
// click, a tap that registers twice — both saw generating === false and each
// ran the whole flow: two /api/generate-resume calls (two credits) and two
// INSERTs into public.resumes for one intent.
//
// singleFlight wraps the async handler with a synchronous lock: while a run is
// in flight, further calls return that same promise instead of starting
// another. Once it settles (success or failure) the lock is released, so a
// deliberate later generation — a new version, or a retry after an error —
// works exactly as before.

export type SingleFlight<A extends unknown[], R> = ((...args: A) => Promise<R>) & {
  /** True while a run is in progress. */
  readonly inFlight: boolean;
};

export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>): SingleFlight<A, R> {
  let current: Promise<R> | null = null;
  const run = (...args: A): Promise<R> => {
    if (current) return current;
    const p = (async () => {
      try {
        return await fn(...args);
      } finally {
        current = null;
      }
    })();
    current = p;
    return p;
  };
  Object.defineProperty(run, "inFlight", { get: () => current !== null });
  return run as SingleFlight<A, R>;
}
