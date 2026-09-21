// Keep-alive ping for the Supabase free plan.
//
// Supabase pauses a free-tier project after ~7 days of inactivity, which takes
// the whole app down (no logins, no generation) until someone manually
// restores it. A daily cron hit on this route counts as activity and keeps the
// database awake.
//
// Security notes:
//  - Uses the ANON client, not the service-role client. Row Level Security
//    applies, so an unauthenticated request reads nothing. The query still
//    reaches Postgres, which is all the pause timer cares about.
//  - `head: true` fetches no rows at all — just a count — so this is about as
//    cheap as a query gets.
//  - If CRON_SECRET is set, Vercel sends it as a bearer token on cron
//    invocations and we reject anything else. If it is not set, the route is
//    open but harmless.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .select("user_id", { count: "exact", head: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("keep-alive ping failed:", msg);
    // 500 so a failed ping shows up as a failed cron run in Vercel rather
    // than silently "succeeding" while the database is actually unreachable.
    return NextResponse.json({ ok: false, error: "ping_failed" }, { status: 500 });
  }
}
