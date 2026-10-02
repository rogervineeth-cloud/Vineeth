import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// POST /api/resumes/[id]/unlock — spend ONE paid credit to make this resume's
// PDF downloadable, once (migration 018 unlock_resume_download). Idempotent:
// a resume already covered by a paid credit is never charged again, and
// concurrent unlocks charge once. The free preview credit can never unlock.
// The download route itself never spends credits.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Resume not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const svc = await createServiceClient();
    const { data, error } = await svc.rpc("unlock_resume_download", { p_user_id: user.id, p_resume_id: id });
    if (error) throw new Error(error.message);
    const outcome = (Array.isArray(data) ? data[0] : data)?.outcome as string | undefined;
    if (outcome === "unlocked" || outcome === "already_entitled") return NextResponse.json({ status: outcome });
    if (outcome === "not_found") return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    if (outcome === "payment_required") {
      return NextResponse.json(
        { error: "payment_required", reason: "NO_PAID_CREDIT", message: "PDF download requires a paid credit.", checkoutUrl: "/pricing" },
        { status: 402 }
      );
    }
    throw new Error(`unexpected outcome ${outcome}`);
  } catch (err) {
    console.error("[unlock] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't unlock this resume right now. No credit was used — please try again." }, { status: 503 });
  }
}
