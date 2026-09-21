import { NextRequest, NextResponse } from "next/server";
import { renderResumePdf, type ResumeJson } from "@/lib/resume-pdf";
import { createClient } from "@/lib/supabase/server";
import { canDownloadResume } from "@/lib/plans";

// ── Main route ─────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const debugId = crypto.randomUUID();

  try {
    const { id } = await params;
    const supabase = await createClient();

    // getUser() revalidates the JWT with the auth server; getSession() just
    // decodes the cookie, which is forgeable on the server side. This gate
    // guards a paid download, so it must not trust an unverified cookie.
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await canDownloadResume(authUser.id, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "PAYMENT_REQUIRED", message: "A paid plan is required to download.", upgrade_url: "/pricing" },
        { status: 402 }
      );
    }

    const [resumeRes, profileRes] = await Promise.all([
      supabase.from("resumes").select("*").eq("id", id).eq("user_id", authUser.id).single(),
      supabase.from("profiles").select("full_name,email,phone,current_city").eq("user_id", authUser.id).single(),
    ]);

    if (resumeRes.error || !resumeRes.data) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

            const rj = JSON.parse(JSON.stringify(resumeRes.data.resume_json).replace(/\u20B9/g, 'Rs.').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x00-\xFF]/g, '')) as ResumeJson;
    // Prefer the contact details frozen onto the resume at generation time.
    // Falling back to the live profile would mean a later profile edit silently
    // changes the identity on a PDF the user already paid for. Resumes created
    // before migration 009 have no snapshot and still use the live profile.
    const snapshot = resumeRes.data.contact_snapshot as {
      full_name?: string; email?: string; phone?: string; current_city?: string;
    } | null;
    const profile = snapshot ?? profileRes.data;
    const name = profile?.full_name ?? "Candidate";
    const safeFilename = (rj.tailored_role ?? name).replace(/[^\x20-\x7E]/g, '-').replace(/\s+/g, '_').replace(/-+/g, '-');
    const contact = [profile?.email, profile?.phone, profile?.current_city].filter(Boolean).join("  ·  ");

    // ── Build PDF ────────────────────────────────────────────────────────
    // Layout lives in lib/resume-pdf.ts: it honours the generator's
    // section_order, paginates instead of drawing past the bottom margin, and
    // applies the template the user actually picked.
    const pdfBytes = await renderResumePdf(
      rj,
      {
        full_name: profile?.full_name,
        email: profile?.email,
        phone: profile?.phone,
        current_city: profile?.current_city,
      },
      resumeRes.data.template as string | null
    );

    // Mark as downloaded — fire and forget
    supabase.from("resumes").update({ downloaded_at: new Date().toISOString() }).eq("id", id).then(() => {});

    const role = (rj.tailored_role ?? "resume").toLowerCase().replace(/\s+/g, "-");

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume-${safeFilename}.pdf"`,
      },
    });
  } catch (err) {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error(`[PDF:${debugId}]`, stack);
    return NextResponse.json(
      { error: "PDF_GENERATION_FAILED", message: "Couldn't generate your PDF. Our team has been notified.", debug_id: debugId },
      { status: 500 }
    );
  }
}
