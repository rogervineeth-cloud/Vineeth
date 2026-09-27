// Loading the signed-in user's profile in the browser, without mistaking a
// failed load for an incomplete profile.
//
// Live QA: a second tab opened on /create?step=review showed the same JD but
// Basics and Roles as incomplete and Generate disabled, while the first tab
// showed the complete profile. The create page and the stepper each loaded
// the profile once, on mount, and treated every failure as "no profile":
//   - create page: getUser().then(...) with no catch and `.single()` with no
//     error check — a rejected getUser, a null user from a transient auth
//     error, or a failed profiles query left `profile` null forever, so the
//     page said "Profile incomplete" and disabled Generate, with no retry;
//   - stepper: a failure fell through to "all steps incomplete".
// A fresh tab is where such failures happen: its first auth calls queue on
// the browser-wide Supabase session lock (navigator.locks, shared by every
// tab of the origin; auth-js steals it after 5 s and the call that lost it
// rejects), and it may refresh a token while another tab does too.
//
// Here a load either succeeds, is definitely signed out, or is an error the
// caller shows as an error (with a retry) — never as an incomplete profile.

export type ProfileLoad<P> =
  | { status: "ready"; user: { id: string; email: string | null }; profile: P | null }
  | { status: "signed_out" }
  | { status: "error"; message: string };

type AuthResult = { data: { user: { id: string; email?: string | null } | null }; error: { name?: string; message?: string } | null };
type RowResult = { data: unknown; error: { message?: string } | null };

/**
 * The slice of a Supabase browser client this needs (so tests can fake it).
 * Deliberately loose: matching SupabaseClient's generics structurally is too
 * deep for the compiler; the shapes used are asserted below.
 */
export type ProfileClient = {
  auth: { getUser(): Promise<unknown> };
  from(table: string): unknown;
};
type ProfileQuery = {
  select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<RowResult> } };
};

export const HYDRATION_RETRY_DELAYS_MS = [600, 1500] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Retryable extends Error {}

/**
 * Runs fn; on a thrown error waits and tries again, up to delays.length more
 * times. The last error is rethrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { delays?: readonly number[]; wait?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const delays = opts.delays ?? HYDRATION_RETRY_DELAYS_MS;
  const wait = opts.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length) throw err;
      await wait(delays[attempt]);
    }
  }
}

/** A signed-out answer from auth-js (no session), as opposed to a failure to find out. */
function isSignedOut(error: AuthResult["error"]): boolean {
  return error?.name === "AuthSessionMissingError";
}

export async function loadSignedInProfile<P>(
  supabase: ProfileClient,
  columns: string,
  opts: { delays?: readonly number[]; wait?: (ms: number) => Promise<void> } = {}
): Promise<ProfileLoad<P>> {
  try {
    return await withRetry(async () => {
      const { data, error } = (await supabase.auth.getUser()) as AuthResult;
      if (!data?.user) {
        if (!error || isSignedOut(error)) return { status: "signed_out" } as const;
        throw new Retryable(error.message ?? "auth error");
      }
      const user = { id: data.user.id, email: data.user.email ?? null };
      // maybeSingle: no row is a real answer (a new user), not an error.
      const res = await (supabase.from("profiles") as ProfileQuery).select(columns).eq("user_id", user.id).maybeSingle();
      if (res.error) throw new Retryable(res.error.message ?? "profile query failed");
      return { status: "ready", user, profile: (res.data as P | null) ?? null } as const;
    }, opts);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
