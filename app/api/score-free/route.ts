// Free-tier ATS scoring endpoint. Deterministic. No LLM.
//
// HARD RULE: this file MUST NOT import @anthropic-ai/sdk (or any LLM SDK).
// A jest test enforces this invariant — see __tests__/score-free.no-llm.test.ts.
//
// Auth: requires a signed-up account. Each account gets exactly ONE free
// ATS preview — usage is recorded in profiles.free_review_used_at. A second
// attempt returns 402 → /pricing.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scoreFree } from "@/lib/score-free";
import { isPricingV2Enabled } from "@/lib/feature-flags";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";

const CREATOR_EMAIL = "rogervineeth@gmail.com";

const inputSchema = z.object({
  resumeText: z.string().min(50, "Resume text too short (min 50 chars)"),
  jdText: z.string().min(50, "Job description too short (min 50 chars)"),
});

export async function POST(req: NextRequest) {
  if (!isPricingV2Enabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json(
      { error: "auth_required", loginUrl: "/signup?next=/free-review" },
      { status: 401 }
    );
  }
  const userId = session.user.id;
  const isCreator = session.user.email === CREATOR_EMAIL;

  // 1-per-account gate (creators bypass).
  if (!isCreator) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("free_review_used_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (profile?.free_review_used_at) {
      track("generate_attempt_blocked_free", { user_id: userId, reason: "FREE_REVIEW_USED" });
      return NextResponse.json(
        { error: "payment_required", reason: "FREE_REVIEW_USED", checkoutUrl: "/pricing" },
        { status: 402 }
      );
    }
  }

  const { resumeText, jdText } = parsed.data;
  const result = scoreFree(resumeText, jdText);

  // Mark used AFTER scoring succeeds. Service client bypasses RLS so the
  // upsert works even on a brand-new profile row.
  if (!isCreator) {
    const svc = await createServiceClient();
    await svc
      .from("profiles")
      .upsert(
        { user_id: userId, free_review_used_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
  }

  return NextResponse.json(result);
}
