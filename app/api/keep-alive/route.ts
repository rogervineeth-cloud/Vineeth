// Keep-alive ping for the Supabase free plan.
//
// Supabase pauses a free-tier project after ~7 days of inactivity, which takes
// the whole app down (no logins, no generation) until someone manually
// restores it. A daily cron hit on this route counts as activity and keeps the
// database awake.
//
// Security notes:
//  - Uses the service-role client. The anon role has no SELECT grant on any
//    public table (verified), so an anon ping is rejected by Postgres before
//    it proves anything about liveness. Service role is the only client that
//    can issue a query guaranteed to succeed when the database is healthy.
//  - The query is `head: true` + `count: exact`: Postgres returns a row COUNT
//    and zero row data. Nothing from the table is read into memory or
//    returned to the caller — the response body is just `{ ok, pingedAt }`.
//  - The route is gated by CRON_SECRET, which Vercel sends as a bearer token
//    on cron invocations. Anything without it gets a 401.
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createServiceClient();
    // NOTE: deliberately NOT using `head: true`. A HEAD request's error
    // responses carry no body, so PostgREST failures came back with every
    // field empty and were impossible to diagnose. A normal GET capped at
    // zero rows is just as cheap and returns real error messages.
    const { error, count } = await supabase
      .from("profiles")
      .select("user_id", { count: "exact" })
      .limit(0);

    if (error) {
      // Logged (private, Vercel dashboard only), never returned to the caller.
      console.error("keep-alive supabase error:", JSON.stringify({
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      }));
      // Env presence/length only — never the values themselves.
      console.error("keep-alive env check:", JSON.stringify({
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        serviceKeyLen: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        anonKeyLen: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").length,
      }));
      throw new Error(error.message || error.code || "unknown supabase error");
    }

    return NextResponse.json({
      ok: true,
      rows: count ?? null,
      pingedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("keep-alive ping failed:", msg);
    // 500 so a failed ping shows up as a failed cron run in Vercel rather
    // than silently "succeeding" while the database is actually unreachable.
    return NextResponse.json({ ok: false, error: "ping_failed" }, { status: 500 });
  }
}
