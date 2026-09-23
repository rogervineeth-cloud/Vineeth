import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — mutations are no-ops here
          }
        },
      },
    }
  );
}

/**
 * Trusted backend client: acts as service_role and bypasses RLS.
 *
 * It must NOT read the request's cookies. It used to be built with the
 * cookie-aware createServerClient, which loads the signed-in user's session
 * and then sends THAT user's access token as the Authorization header — the
 * service key went along only as `apikey`. PostgREST takes the role from the
 * token, so every "service" write ran as `authenticated`.
 *
 * Production, 2026-09-23: consumeCredit's UPDATE on user_plans (a table
 * `authenticated` may only read) returned 403 "permission denied", so a paid
 * user with 3/3 credits got "You've used all credits" after the AI call had
 * already run. Requests with no session cookie (the keep-alive cron) were
 * unaffected, which is why it looked environment-specific.
 *
 * No session, no persistence, no refresh: the service key is the only
 * credential this client ever sends.
 */
export async function createServiceClient(): Promise<SupabaseClient> {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
