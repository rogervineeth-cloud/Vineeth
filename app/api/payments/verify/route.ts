import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPaymentsConfig } from "@/lib/payments/config";
import { paymentStore } from "@/lib/payments/store";
import { verifyCheckout, UNAVAILABLE } from "@/lib/payments/service";

// POST /api/payments/verify — called by the browser after Razorpay Checkout
// reports success. Grants only after the signature checks out AND Razorpay's
// own record of the payment (fetched here) is captured, for this order, for
// the order's amount. The webhook does the same independently.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const config = getPaymentsConfig();
  if (!config.enabled) return NextResponse.json(UNAVAILABLE.body, { status: UNAVAILABLE.status });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  try {
    const res = await verifyCheckout(config, paymentStore(), user.id, body);
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    console.error("[payments] verify failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "PAYMENTS_ERROR", message: "Something went wrong on our side. If you were charged, your purchase will be added automatically." }, { status: 500 });
  }
}
