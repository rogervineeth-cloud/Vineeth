// Server-side amount validation for the (deferred) checkout flow.
// When Razorpay lands in the follow-up PR this is where the order intent
// is created. Today it just confirms the client-displayed total matches the
// canonical PLANS + ADDONS math, so a tampered client cannot spoof a price.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLANS, ADDONS } from "@/lib/plan-config";

const inputSchema = z.object({
  planType: z.enum(["single", "fresher", "job_hunter", "career"]).nullable(),
  withAddon: z.boolean(),
  totalInr: z.number().int().nonnegative(),
});

const LINKEDIN = ADDONS.find((a) => a.id === "linkedin_rewrite")!;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { planType, withAddon, totalInr } = parsed.data;

  // Standalone add-on purchase: no plan, must include the addon.
  if (planType === null) {
    if (!withAddon) {
      return NextResponse.json({ error: "Standalone purchase requires the add-on" }, { status: 400 });
    }
    const expected = LINKEDIN.priceInr;
    if (totalInr !== expected) {
      return NextResponse.json({ error: "Amount mismatch", expected }, { status: 400 });
    }
    return NextResponse.json({ ok: true, expected });
  }

  const plan = PLANS.find((p) => p.type === planType);
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const expected = plan.priceInr + (withAddon ? LINKEDIN.bundlePriceInr : 0);
  if (totalInr !== expected) {
    return NextResponse.json({ error: "Amount mismatch", expected }, { status: 400 });
  }

  return NextResponse.json({ ok: true, expected });
}
