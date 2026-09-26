import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canGenerateResume, canGenerateFreeRegen, consumeCredit, userOwnsResume } from "@/lib/plans";
import { track } from "@/lib/analytics";
import { MODEL_RESUME_CREATOR, MODEL_RESUME_STANDARD } from "@/lib/models";
import { buildGenerationPayload, buildModelRequest, parseModelReply, postProcessResume } from "@/lib/resume-generation";
import { usableSections, hasResumeContent, MISSING_RESUME_CONTENT } from "@/lib/profile-completeness";
import { cleanTargetRoles } from "@/lib/target-roles";
export const maxDuration = 60;
const CREATOR_EMAIL = "rogervineeth@gmail.com";
const inputSchema = z.object({
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




export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    const { jd_text, jd_url, jd_keywords, template, user_profile, regen_of_resume_id } = parsed.data;
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
    // The client performs the INSERT, so it cannot be trusted to decide what
    // the parent is — it could name any resume id, including another user's.
    // Ownership is therefore resolved HERE and only a server-verified id is
    // echoed back for the client to store.
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
      return NextResponse.json(
        { error: "We hit a glitch drafting your resume. Please try once more." },
        { status: 500 }
      );
    }
    let resumeJson: unknown = parsedReply.json;

    // Sanitiser, then the output contract. The client writes ats_score /
    // tailored_role / matched_keywords / missing_keywords straight into typed
    // columns; a missing field becomes a NULL row that renders as a red "0" —
    // silently, after the credit is spent. Normalise what can be defaulted
    // honestly and refuse the rest BEFORE consuming the credit.
    const normalised = postProcessResume(resumeJson, parsed.data.user_profile);
    resumeJson = normalised.resume;
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
      return NextResponse.json(
        { error: "We hit a glitch drafting your resume. Please try once more." },
        { status: 500 }
      );
    }

    // Consume credit only after a successful parse
    if (!isCreator && !isFreeRegen) {
      const credited = await consumeCredit(userId);
      if (!credited) {
        track("generate_attempt_blocked_free", { user_id: userId, reason: "CREDITS_EXHAUSTED" });
        return NextResponse.json(
          { error: "payment_required", reason: "CREDITS_EXHAUSTED", checkoutUrl: "/pricing" },
          { status: 402 }
        );
      }
    }
    return NextResponse.json({
      resume_json: resumeJson,
      is_free_regen: isFreeRegen,
      // Server-verified parent id, or null. The client writes THIS value to
      // resumes.regen_of_resume_id — never its own local copy — so an id the
      // caller does not own can never reach the column.
      regen_of_resume_id: validatedParentId,
    });
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
