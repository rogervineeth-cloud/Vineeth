import { NextRequest, NextResponse } from "next/server";
import { getPaymentsConfig } from "@/lib/payments/config";
import { paymentStore } from "@/lib/payments/store";
import { handleWebhook, UNAVAILABLE } from "@/lib/payments/service";

// POST /api/payments/razorpay/webhook — Razorpay server-to-server events.
// Authenticated by X-Razorpay-Signature (HMAC of the RAW body with
// RAZORPAY_WEBHOOK_SECRET), de-duplicated by X-Razorpay-Event-Id. No session.
// /api/* is outside the site's Basic-auth gate (middleware.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const config = getPaymentsConfig();
  if (!config.enabled) return NextResponse.json(UNAVAILABLE.body, { status: UNAVAILABLE.status });

  // Read the raw body exactly as sent: the signature is over these bytes.
  const raw = await req.text();
  try {
    const res = await handleWebhook(config, paymentStore(), raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    console.error("[payments] webhook processing failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 500 }); // Razorpay retries
  }
}
