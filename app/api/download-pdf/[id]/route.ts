import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { canDownloadResume } from "@/lib/plans";

type ResumeJson = {
  summary?: string;
  experience?: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills?: string[];
  education?: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  projects?: Array<{ name: string; description: string; tech: string[] }>;
  tailored_role?: string;
};

// ── Layout constants (A4 = 595 x 842 pt) ──────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const ML = 50;   // margin left
const MR = 50;   // margin right
const MT = 60;   // margin top
const MB = 60;   // margin bottom
const CONTENT_W = PAGE_W - ML - MR;
const GREEN = rgb(0.122, 0.361, 0.227); // #1f5c3a
const BLACK = rgb(0.102, 0.102, 0.102); // #1a1a1a
const GREY  = rgb(0.42, 0.42, 0.42);

// ── Text wrapping ──────────────────────────────────────────────────────────
function wrapText(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // If single word too long, push it anyway to avoid infinite loop
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Draw helpers ───────────────────────────────────────────────────────────
type DrawCtx = {
  page: import("pdf-lib").PDFPage;
  boldFont: import("pdf-lib").PDFFont;
  regularFont: import("pdf-lib").PDFFont;
  y: number; // current cursor (decrements as we draw downward)
};

function drawText(
  ctx: DrawCtx,
  text: string,
  opts: { size: number; font?: import("pdf-lib").PDFFont; color?: import("pdf-lib").Color; x?: number; maxWidth?: number; lineHeight?: number }
): number {
  const font = opts.font ?? ctx.regularFont;
  const color = opts.color ?? BLACK;
  const x = opts.x ?? ML;
  const maxW = opts.maxWidth ?? CONTENT_W;
  const lh = opts.lineHeight ?? opts.size * 1.45;

  const lines = wrapText(text, font, opts.size, maxW);
  for (const line of lines) {
    ctx.page.drawText(line, { x, y: ctx.y, size: opts.size, font, color });
    ctx.y -= lh;
  }
  return ctx.y;
}

function drawSectionHeader(ctx: DrawCtx, title: string) {
  ctx.y -= 6;
  // Green rule above header
  ctx.page.drawLine({
    start: { x: ML, y: ctx.y },
    end: { x: ML + CONTENT_W, y: ctx.y },
    thickness: 0.5,
    color: GREEN,
  });
  ctx.y -= 11;
  ctx.page.drawText(title.toUpperCase(), { x: ML, y: ctx.y, size: 8, font: ctx.boldFont, color: GREEN });
  ctx.y -= 10;
}

function drawHRule(ctx: DrawCtx) {
  ctx.page.drawLine({
    start: { x: ML, y: ctx.y },
    end: { x: ML + CONTENT_W, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.82, 0.84, 0.87),
  });
  ctx.y -= 10;
}

// ── Main route ─────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const debugId = crypto.randomUUID();

  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await canDownloadResume(session.user.id, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "PAYMENT_REQUIRED", message: "A paid plan is required to download.", upgrade_url: "/pricing" },
        { status: 402 }
      );
    }

    const [resumeRes, profileRes] = await Promise.all([
      supabase.from("resumes").select("*").eq("id", id).eq("user_id", session.user.id).single(),
      supabase.from("profiles").select("full_name,email,phone,current_city").eq("user_id", session.user.id).single(),
    ]);

    if (resumeRes.error || !resumeRes.data) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

            const rj = JSON.parse(JSON.stringify(resumeRes.data.resume_json).replace(/\u20B9/g, 'Rs.')) as ResumeJson;
    const profile = profileRes.data;
    const name = profile?.full_name ?? "Candidate";
    const contact = [profile?.email, profile?.phone, profile?.current_city].filter(Boolean).join("  ·  ");

    // ── Build PDF ────────────────────────────────────────────────────────
    const pdfDoc = await PDFDocument.create();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const ctx: DrawCtx = { page, boldFont, regularFont, y: PAGE_H - MT };

    // Name
    page.drawText(name, { x: ML, y: ctx.y, size: 20, font: boldFont, color: BLACK });
    ctx.y -= 26;

    // Contact line
    page.drawText(contact, { x: ML, y: ctx.y, size: 9, font: regularFont, color: GREY });
    ctx.y -= 8;

    drawHRule(ctx);

    // ── Summary ──────────────────────────────────────────────────────────
    if (rj.summary?.trim()) {
      drawSectionHeader(ctx, "Summary");
      drawText(ctx, rj.summary, { size: 10, lineHeight: 15 });
      ctx.y -= 4;
    }

    // ── Experience ───────────────────────────────────────────────────────
    if ((rj.experience?.length ?? 0) > 0) {
      drawSectionHeader(ctx, "Experience");
      for (const exp of rj.experience!) {
        // Company — Role  |  Duration · Location
        const leftLabel = `${exp.company} — ${exp.role}`;
        const rightLabel = `${exp.duration}${exp.location ? "  ·  " + exp.location : ""}`;
        page.drawText(leftLabel, { x: ML, y: ctx.y, size: 10, font: boldFont, color: BLACK });
        const rightW = regularFont.widthOfTextAtSize(rightLabel, 9);
        page.drawText(rightLabel, { x: ML + CONTENT_W - rightW, y: ctx.y, size: 9, font: regularFont, color: GREY });
        ctx.y -= 14;

        // Bullets
        for (const bullet of exp.bullets ?? []) {
          const trimmed = bullet.trim();
          if (!trimmed) continue;
          const bulletX = ML + 10;
          const bulletW = CONTENT_W - 10;
          page.drawText("·", { x: ML + 2, y: ctx.y, size: 10, font: boldFont, color: GREEN });
          const lines = wrapText(trimmed, regularFont, 9.5, bulletW);
          for (let li = 0; li < lines.length; li++) {
            page.drawText(lines[li], { x: bulletX, y: ctx.y, size: 9.5, font: regularFont, color: BLACK });
            ctx.y -= 13;
          }
        }
        ctx.y -= 4;
      }
    }

    // ── Skills ───────────────────────────────────────────────────────────
    if ((rj.skills?.length ?? 0) > 0) {
      drawSectionHeader(ctx, "Skills");
      const skillLine = rj.skills!.join("  ·  ");
      drawText(ctx, skillLine, { size: 9.5, lineHeight: 14 });
      ctx.y -= 4;
    }

    // ── Education ────────────────────────────────────────────────────────
    if ((rj.education?.length ?? 0) > 0) {
      drawSectionHeader(ctx, "Education");
      for (const edu of rj.education!) {
        const leftLabel = edu.institution;
        const rightLabel = `${edu.year}${edu.location ? "  ·  " + edu.location : ""}`;
        page.drawText(leftLabel, { x: ML, y: ctx.y, size: 10, font: boldFont, color: BLACK });
        const rightW = regularFont.widthOfTextAtSize(rightLabel, 9);
        page.drawText(rightLabel, { x: ML + CONTENT_W - rightW, y: ctx.y, size: 9, font: regularFont, color: GREY });
        ctx.y -= 13;

        const degreeLine = edu.degree + (edu.cgpa ? `  ·  ${edu.cgpa}` : "");
        page.drawText(degreeLine, { x: ML, y: ctx.y, size: 9, font: regularFont, color: GREY });
        ctx.y -= 14;
      }
    }

    // ── Projects ─────────────────────────────────────────────────────────
    if ((rj.projects?.length ?? 0) > 0) {
      drawSectionHeader(ctx, "Projects");
      for (const proj of rj.projects!) {
        page.drawText(proj.name, { x: ML, y: ctx.y, size: 10, font: boldFont, color: BLACK });
        ctx.y -= 13;
        if (proj.description?.trim()) {
          drawText(ctx, proj.description, { size: 9.5, color: rgb(0.33, 0.33, 0.33), lineHeight: 13 });
        }
        if ((proj.tech?.length ?? 0) > 0) {
          page.drawText(proj.tech.join("  ·  "), { x: ML, y: ctx.y, size: 8.5, font: regularFont, color: GREEN });
          ctx.y -= 12;
        }
        ctx.y -= 4;
      }
    }

    // Ensure we haven't overflowed (basic guard — content should fit on A4 for normal resumes)
    if (ctx.y < MB) {
      console.warn(`[PDF:${debugId}] Content may have overflowed page bottom (y=${ctx.y})`);
    }

    const pdfBytes = await pdfDoc.save();

    // Mark as downloaded — fire and forget
    supabase.from("resumes").update({ downloaded_at: new Date().toISOString() }).eq("id", id).then(() => {});

    const role = (rj.tailored_role ?? "resume").toLowerCase().replace(/\s+/g, "-");

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume-${role}.pdf"`,
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
