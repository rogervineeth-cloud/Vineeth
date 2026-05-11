import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { grantTestPlan } from "@/lib/plans";
import type { PlanType } from "@/lib/plan-config";
import { PLAN_ALLOTMENTS } from "@/lib/plan-config";
import { grantTestAddon, type AddonId } from "@/lib/addons";

// "free" is implicit — never materialized as a user_plans row.
type PaidPlan = Exclude<PlanType, "free">;
const VALID_PLANS = (Object.keys(PLAN_ALLOTMENTS) as PlanType[]).filter(
    (p): p is PaidPlan => p !== "free"
  );
const VALID_ADDONS: AddonId[] = ["linkedin_rewrite"];

export async function POST(req: NextRequest) {
    // Defence in depth: refuse in production regardless of NEXT_PUBLIC_TEST_MODE.
  // Prevents a misconfigured env var from granting free credits in prod.
  const isProd =
        process.env.VERCEL_ENV === "production" ||
        process.env.NODE_ENV === "production";
    if (isProd || process.env.NEXT_PUBLIC_TEST_MODE !== "true") {
          return NextResponse.json({ error: "Not available in production" }, { status: 403 });
    }

  const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

  const body = await req.json().catch(() => ({}));
    const { plan_type, addon } = body as { plan_type?: string; addon?: string };

  if (!plan_type || !(VALID_PLANS as readonly string[]).includes(plan_type)) {
        return NextResponse.json(
          { error: `plan_type must be one of: ${VALID_PLANS.join(", ")}` },
          { status: 400 }
              );
  }
    if (addon && !VALID_ADDONS.includes(addon as AddonId)) {
          return NextResponse.json(
            { error: `addon must be one of: ${VALID_ADDONS.join(", ")}` },
            { status: 400 }
                );
    }

  try {
        const plan = await grantTestPlan(session.user.id, plan_type as PlanType);
        const addonRow = addon
          ? await grantTestAddon(session.user.id, addon as AddonId)
                : null;
        return NextResponse.json({ plan, addon: addonRow });
  } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("grant-test-plan error:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
  }
}
