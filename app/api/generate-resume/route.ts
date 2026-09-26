import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canGenerateResume, canGenerateFreeRegen, userOwnsResume } from "@/lib/plans";
import { track } from "@/lib/analytics";
import { MODEL_RESUME_CREATOR, MODEL_RESUME_STANDARD } from "@/lib/models";
import { buildGenerationPayload, buildModelRequest, parseModelReply, postProcessResume } from "@/lib/resume-generation";
import { usableSections, hasResumeContent, MISSING_RESUME_CONTENT } from "@/lib/profile-completeness";
import { cleanTargetRoles } from "@/lib/target-roles";
import { generationStore, generationFingerprint, type GeneratedResumeRow } from "@/lib/generation-idempotency";
export const maxDuration = 60;
const CREATOR_EMAIL = "rogervineeth@gmail.com";
const TEMPLATES = new Set(["classic", "modern", "compact", "executive"]);
const inputSchema = z.object({
  // One generation attempt. The browser makes a new one per click and reuses
  // it only to retry the identical request, so a retry never charges twice
  // (migration 013). Required: a client too old to send one would also
  // insert the resume itself, duplicating the row the server now writes.
  request_key: z.string().uuid(),
  jd_text: z.string().min(100, "Job description too short (min 100 chars)"),
  jd_url: z.string().url().optional().or(z.literal("")),
  jd_keywords: z.array(z.string()).optional(),
  template: z.string().optional(),
  regen_of_resume_id: z.string().uuid().optional(),
  user_profile: z.object({
    full_name: z.string(),
    email: z.string(),
    phone: z.string().nullable().optional(),
    current_city: z.string().nullable().optional(),
    graduation_year: z.number().nullable().optional(),
    // Never tailor to the role picker's "Other" sentinel or a blank entry.
    target_roles: z.array(z.string()).optional().transform((r) => (r === undefined ? undefined : cleanTargetRoles(r))),
    linkedin_data: z.record(z.string(), z.unknown()).nullable().optional(),
    summary: z.string().optional(),
    experience: z.array(z.object({
      company: z.string(), role: z.string(), duration: z.string(),
      location: z.string(), bullets: z.array(z.string()),
    })).optional(),
    skills: z.array(z.string()).optional(),
    education: z.array(z.object({
      institution: z.string(), degree: z.string(), year: z.string(),
      location: z.string(), cgpa: z.string().optional(),
    })).optional(),
    projects: z.array(z.object({
      name: z.string(), description: z.string(), tech: z.array(z.string()),
    })).optional(),
  }),
});




/** The stored resume for an attempt that already finished (no charge, no model call). */
async function replayResponse(store: ReturnType<typeof generationStore>, userId: string, resumeId: string) {
  const stored = await store.load(userId, resumeId);
  if (!stored) {
    return NextResponse.json(
      { error: "This resume was already generated but is no longer available. Please generate again." },
      { status: 410 }
    );
  }
  return NextResponse.json({
    resume_id: stored.id,
    resume_json: stored.resume_json,
    is_free_regen: false,
    regen_of_resume_id: stored.regen_of_resume_id,
    replayed: true,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || !("request_key" in body)) {
      return NextResponse.json(
        { error: "CLIENT_OUTDATED", message: "Please refresh the page and try again." },
        { status: 400 }
      );
    }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    const { jd_text, jd_url, jd_keywords, template, user_profile, regen_of_resume_id, request_key } = parsed.data;
    // Auth. getUser() revalidates the JWT with the auth server; getSession()
    // just decodes the cookie, which is forgeable on the server side.
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = authUser.id;
    const isCreator = authUser.email === CREATOR_EMAIL;
    // Regeneration lineage.
    //
    // The client names the parent, so it cannot be trusted — it could name any
    // resume id, including another user's. Ownership is therefore resolved
    // HERE, and only this server-verified id is written with the resume
    // (complete_resume_generation re-checks ownership in the database too).
    //
    // An unowned, deleted or unknown parent is safely IGNORED rather than
    // rejected: it is treated as an ordinary generation with no lineage. That
    // is exactly the behaviour today (canGenerateFreeRegen already returns
    // false for all three cases, so the request was charged and succeeded),
    // so ignoring changes nothing for users while preventing a cross-user id
    // from ever being written. Rejecting instead would newly break a real
    // case now that users can delete resumes: regenerating from a stale tab
    // whose parent has since been deleted would start failing.
    let validatedParentId: string | null = null;
    let isFreeRegen = false;
    if (regen_of_resume_id) {
      if (await userOwnsResume(userId, regen_of_resume_id)) {
        validatedParentId = regen_of_resume_id;
        isFreeRegen = await canGenerateFreeRegen(userId, regen_of_resume_id, jd_text);
      } else {
        console.warn(
          "[generate-resume] ignoring regen parent not owned by caller:",
          { user_id: userId, regen_of_resume_id }
        );
        track("generate_resume_sanitised", {
          user_id: userId,
          warnings: "ignored_unowned_regen_parent",
          warning_count: 1,
        });
      }
    }
    if (!isCreator && !isFreeRegen) {
      const { allowed, reason } = await canGenerateResume(userId);
      if (!allowed) {
        track("generate_attempt_blocked_free", { user_id: userId, reason: reason ?? "NO_PLAN" });
        return NextResponse.json(
          { error: "payment_required", reason, checkoutUrl: "/pricing" },
          { status: 402 }
        );
      }
    }
    // Server-side defense: never call Anthropic for incomplete profiles.
    // Experience, Education and Projects are each optional, but at least one
    // must hold a real entry — see lib/profile-completeness.ts. Blank rows (the
    // profile page saves one for a skipped section) and placeholder employers
    // do not count. This runs before any credit is consumed.
    const p = parsed.data.user_profile;
    const incomplete: string[] = [];
    if (!p.full_name?.trim()) incomplete.push("full_name");
    if (!p.email?.trim()) incomplete.push("email");
    const usable = usableSections(p);
    if (!hasResumeContent(usable)) incomplete.push(MISSING_RESUME_CONTENT);

    if (incomplete.length > 0) {
      return NextResponse.json(
        { error: "PROFILE_INCOMPLETE", missing: incomplete },
        { status: 422 }
      );
    }

    // Hand the model only real entries, so it never sees placeholder rows like
    // { company: "Previous Organization" } or a skipped section's blank row.
    parsed.data.user_profile.experience = usable.experience;
    parsed.data.user_profile.education = usable.education;
    parsed.data.user_profile.projects = usable.projects;
    // ── Idempotency (migration 013) ──────────────────────────────────────
    // Before any model call or charge: claim this attempt. An identical
    // generation already running in another tab or device is refused here,
    // and a retry of an attempt that already finished gets its resume back.
    const store = generationStore();
    const fingerprint = generationFingerprint({
      jd_text, template, jd_keywords, user_profile: parsed.data.user_profile, regen_of_resume_id: validatedParentId,
    });
    let begun;
    try {
      begun = await store.begin(userId, request_key, fingerprint);
    } catch (err) {
      // Fail closed: e.g. the migration is not applied yet. Nothing spent.
      console.error("[generate-resume] begin failed:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "Resume generation is temporarily unavailable. No credit was used — please try again shortly." },
        { status: 503 }
      );
    }
    if (begun.outcome === "replay") return replayResponse(store, userId, begun.resumeId);
    if (begun.outcome === "in_progress") {
      return NextResponse.json(
        { error: "GENERATION_IN_PROGRESS", message: "This resume is already being generated in another tab or window. It will appear on your dashboard when it's ready — no extra credit is used." },
        { status: 409 }
      );
    }
    if (begun.outcome === "key_reused") {
      return NextResponse.json(
        { error: "IDEMPOTENCY_KEY_REUSED", message: "Please try again." },
        { status: 409 }
      );
    }

    // From here the attempt holds the lock: every exit must complete or fail it.
    let finished = false;
    const failAttempt = async (reason: string) => {
      if (finished) return;
      finished = true;
      try { await store.fail(userId, request_key, reason); } catch (e) {
        console.error("[generate-resume] fail() failed (lease will expire):", e instanceof Error ? e.message : e);
      }
    };
    try {
      // Determine model based on creator status (tiering placeholder)
      // Pro users get sonnet, free/basic get haiku. IDs live in lib/models.ts —
      // an inlined, non-existent ID here broke generation entirely once already.
      const model = isCreator ? MODEL_RESUME_CREATOR : MODEL_RESUME_STANDARD;
      // Build the labelled payload, call the model and parse the reply — the
      // same functions the resume-quality eval harness uses.
      const userPayload = buildGenerationPayload({ jd_text, jd_url, jd_keywords, template, user_profile });
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await client.messages.create(buildModelRequest(model, userPayload));
      const parsedReply = parseModelReply(message);
      if (!parsedReply) {
        const first = message.content[0];
        const rawText = first && first.type === "text" ? first.text : "";
        console.error("Failed to parse AI response:", rawText.slice(0, 500));
        await failAttempt("parse_error");
        return NextResponse.json(
          { error: "We hit a glitch drafting your resume. Please try once more." },
          { status: 500 }
        );
      }

      // Sanitiser, then the output contract. ats_score / tailored_role /
      // matched_keywords / missing_keywords go straight into typed columns; a
      // missing field would become a NULL that renders as a red "0".
      // Normalise what can be defaulted honestly and refuse the rest BEFORE
      // any credit is consumed.
      const normalised = postProcessResume(parsedReply.json, parsed.data.user_profile);
      const resumeJson = normalised.resume as Record<string, unknown>;
      if (normalised.warnings.length > 0) {
        track("generate_resume_sanitised", { user_id: userId, warnings: normalised.warnings.join(","), warning_count: normalised.warnings.length });
        console.warn("[generate-resume] sanitiser warnings:", normalised.warnings);
      }
      if (normalised.repaired.length > 0) {
        console.warn("[generate-resume] repaired missing fields:", normalised.repaired);
      }
      if (normalised.fatal.length > 0) {
        // No credit consumed — the user retries for free.
        console.error("[generate-resume] contract violation, refusing to save:", normalised.fatal);
        track("generate_resume_sanitised", {
          user_id: userId,
          warnings: `contract_violation:${normalised.fatal.join("/")}`,
          warning_count: normalised.fatal.length,
        });
        await failAttempt("contract_violation");
        return NextResponse.json(
          { error: "We hit a glitch drafting your resume. Please try once more." },
          { status: 500 }
        );
      }

      // One transaction: charge (unless creator / free regeneration), insert
      // the resume, mark the attempt done. The browser used to insert the row
      // after this route charged, so two tabs meant two of each.
      const row: GeneratedResumeRow = {
        jd_text,
        resume_json: resumeJson,
        ats_score: resumeJson.ats_score as number,
        tailored_role: resumeJson.tailored_role as string,
        matched_keywords: (resumeJson.matched_keywords as string[]) ?? [],
        missing_keywords: (resumeJson.missing_keywords as string[]) ?? [],
        // Contact details frozen as they are now (migration 009).
        contact_snapshot: {
          full_name: user_profile.full_name ?? "",
          email: user_profile.email ?? "",
          phone: user_profile.phone ?? "",
          current_city: user_profile.current_city ?? "",
        },
        template: template && TEMPLATES.has(template) ? template : null,
        // Server-verified parent only — never the client's copy.
        regen_of_resume_id: validatedParentId,
      };
      const done = await store.complete(userId, request_key, !isCreator && !isFreeRegen, row);
      finished = true;
      if (done.outcome === "payment_required") {
        track("generate_attempt_blocked_free", { user_id: userId, reason: "CREDITS_EXHAUSTED" });
        return NextResponse.json(
          { error: "payment_required", reason: "CREDITS_EXHAUSTED", checkoutUrl: "/pricing" },
          { status: 402 }
        );
      }
      if (done.outcome === "replay") return replayResponse(store, userId, done.resumeId);
      if (done.outcome !== "completed") {
        // The lease ran out (or begin was lost): nothing was charged or saved.
        return NextResponse.json(
          { error: "GENERATION_EXPIRED", message: "This generation took too long and was stopped. No credit was used — please try again." },
          { status: 409 }
        );
      }
      return NextResponse.json({
        resume_id: done.resumeId,
        resume_json: resumeJson,
        is_free_regen: isFreeRegen,
        // Server-verified parent id, or null.
        regen_of_resume_id: validatedParentId,
      });
    } catch (err) {
      await failAttempt("error");
      throw err;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Generate resume error:", msg);
    if (msg.includes("401") || msg.includes("authentication") || msg.includes("API key")) {
      return NextResponse.json({ error: "Configuration error. Please contact support." }, { status: 500 });
    }
    if (msg.includes("credit") || msg.includes("402") || msg.includes("billing")) {
      return NextResponse.json({ error: "Service temporarily unavailable. Please try again later." }, { status: 500 });
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      return NextResponse.json({ error: "Generation timed out - please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Resume generation failed. Please try again." }, { status: 500 });
  }
}
