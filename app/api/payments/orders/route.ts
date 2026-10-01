import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPaymentsConfig } from "@/lib/payments/config";
import { paymentStore } from "@/lib/payments/store";
import { startCheckout, UNAVAILABLE } from "@/lib/payments/service";

// POST /api/payments/orders — create (or return) the server-priced order for
// one checkout attempt. Unavailable unless payments are explicitly configured
// (lib/payments/config.ts). Body: { sku, with_linkedin_addon?, request_id }.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const config = getPaymentsConfig();
  if (!config.enabled) return NextResponse.json(UNAVAILABLE.body, { status: UNAVAILABLE.status });

  // getUser() revalidates the JWT with the auth server; getSession() just
  // decodes the cookie, which is forgeable on the server side.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  try {
    const res = await startCheckout(config, paymentStore(), { id: user.id, email: user.email ?? null }, body);
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    console.error("[payments] orders failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "PAYMENTS_ERROR", message: "Something went wrong on our side. If you were charged, your purchase will be added automatically." }, { status: 500 });
  }
}
