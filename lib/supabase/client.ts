import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Singleton browser Supabase client.
//
// Why: @supabase/ssr (and gotrue-js under the hood) registers a Web Lock on
// the "sb-<project>-auth-token" key the first time a client is constructed in
// the browser. Each additional createClient() call re-registers another lock.
// Under React 18 Strict Mode (development) and just generally with several
// components mounting in parallel, those locks contend and one of the
// getSession() calls never resolves — the UI hangs on "Loading profile...".
//
// Memoising the client on first call eliminates the contention. All callers
// share one auth-state machine, which is also the recommended pattern in
// Supabase’s own Next.js docs.
let _client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _client;
}
