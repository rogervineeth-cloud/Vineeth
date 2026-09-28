import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureBetaCredits } from "@/lib/beta";

// POST /api/beta/claim — gives the signed-in account its Free Beta credits if
// it has never had them (migration 015). Idempotent: the create page and the
// dashboard call it on load so the credits are visible before the first
// generation; /api/generate-resume also grants them before its credit check.
// The account is always the caller's own (from the verified session); the
// request body is ignored.
export async function POST() {
  const supabase = await createClient();
  // getUser() revalidates the JWT with the auth server; getSession() just
  // decodes the cookie, which is forgeable on the server side.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await ensureBetaCredits(user.id);
  return NextResponse.json({ status }, { status: status === "unavailable" ? 503 : 200 });
}
