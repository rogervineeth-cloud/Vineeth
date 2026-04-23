import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { grantTestPlan } from "@/lib/plans";
import type { PlanType } from "@/lib/plan-config";
import { PLAN_ALLOTMENTS } from "@/lib/plan-config";

const VALID_PLANS = Object.keys(PLAN_ALLOTMENTS) as PlanType[];

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_TEST_MODE !== "true") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { plan_type } = body as { plan_type?: string };

  if (!plan_type || !VALID_PLANS.includes(plan_type as PlanType)) {
    return NextResponse.json(
      { error: `plan_type must be one of: ${VALID_PLANS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const plan = await grantTestPlan(session.user.id, plan_type as PlanType);
    return NextResponse.json({ plan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("grant-test-plan error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
