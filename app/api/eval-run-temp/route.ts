// TEMPORARY — resume-quality eval runner for Vercel PREVIEW only.
// Delete this file (and the EVAL_RUN_TOKEN preview variable) once the live
// matrix is captured. It must never reach main.
//
// Why it exists: the eval needs the real model, and the only Anthropic key is
// a sensitive Vercel variable that must not be copied out. This route runs
// the committed scenarios on the preview deployment, with the preview's own
// key, through the SAME shared generation path as /api/generate-resume.
//
// Locked down:
//   - 404 unless VERCEL_ENV === "preview" (production can never serve it)
//   - 404 unless EVAL_RUN_TOKEN is set (>= 32 chars) and `t` matches it
//     (constant-time compare); the variable exists only for this branch
//   - GET only; no request body is read; the only input is a committed
//     scenario id — arbitrary profiles or JDs cannot be submitted
//   - no Supabase, no plans/credits, no auth, no writes (a test enforces the
//     import graph)
//   - the response carries only the generated resume for fictional
//     fixtures, the sanitiser's notes and token usage — no headers, no env
//
// Also behind Vercel Authentication (ssoProtection: all_except_custom_domains).

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_RESUME_STANDARD } from "@/lib/models";
import { analyzeJd } from "@/lib/jd-keywords";
import { usableSections } from "@/lib/profile-completeness";
import {
  buildGenerationPayload,
  buildModelRequest,
  parseModelReply,
  postProcessResume,
  type GenerationProfile,
} from "@/lib/resume-generation";
import scenariosFile from "@/evals/resume-quality/scenarios.json";
import A from "@/evals/resume-quality/fixtures/profiles/A-fresher-projects.json";
import B from "@/evals/resume-quality/fixtures/profiles/B-recent-grad-intern.json";
import C from "@/evals/resume-quality/fixtures/profiles/C-experienced-backend.json";
import D from "@/evals/resume-quality/fixtures/profiles/D-career-returner.json";
import E from "@/evals/resume-quality/fixtures/profiles/E-multi-role-fullstack.json";
import GOOG from "@/evals/resume-quality/fixtures/jds/google-swe2-cloud-bengaluru.json";
import AMZ2 from "@/evals/resume-quality/fixtures/jds/amazon-sde2-10533780.json";
import AMZ from "@/evals/resume-quality/fixtures/jds/amazon-sde-2968029.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROFILES: Record<string, { user_profile: unknown }> = { A, B, C, D, E };
const JDS: Record<string, { text: string }> = { "GOOG-SWE2": GOOG, "AMZ-SDE2": AMZ2, "AMZ-SDE": AMZ };
const SCENARIOS = new Map(
  (scenariosFile as { scenarios: { id: string; profile: string; jd: string }[] }).scenarios.map((s) => [s.id, s])
);

const notFound = () => new NextResponse("Not Found", { status: 404 });

function tokenOk(given: string | null): boolean {
  const expected = process.env.EVAL_RUN_TOKEN ?? "";
  if (expected.length < 32 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return notFound();
  const q = req.nextUrl.searchParams;
  if (!tokenOk(q.get("t"))) return notFound();

  // Preflight: prove the preview has the key without revealing anything.
  if (q.get("check") === "1") {
    return NextResponse.json({
      vercel_env: process.env.VERCEL_ENV,
      anthropic_key_present: (process.env.ANTHROPIC_API_KEY ?? "").length > 0,
      scenarios: [...SCENARIOS.keys()],
      model: MODEL_RESUME_STANDARD,
    });
  }

  const s = SCENARIOS.get(q.get("s") ?? "");
  if (!s) return NextResponse.json({ error: "unknown scenario" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "no model key" }, { status: 503 });

  const profile = structuredClone(PROFILES[s.profile].user_profile) as GenerationProfile;
  Object.assign(profile, usableSections(profile));
  const jdText = JDS[s.jd].text;
  const payload = buildGenerationPayload({
    jd_text: jdText,
    jd_keywords: analyzeJd(jdText).keywords,
    template: "classic",
    user_profile: profile,
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create(buildModelRequest(MODEL_RESUME_STANDARD, payload));
  const parsed = parseModelReply(message);
  const post = parsed ? postProcessResume(parsed.json, profile) : null;

  const body = {
    scenario: s.id,
    model: MODEL_RESUME_STANDARD,
    stop_reason: message.stop_reason,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
    parse_ok: !!parsed,
    final_resume: post?.resume ?? null,
    sanitiser_warnings: post?.warnings ?? [],
    repaired: post?.repaired ?? [],
    fatal: post?.fatal ?? [],
  };
  // Lets the caller prove the capture was transcribed byte-for-byte.
  const sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return NextResponse.json({ ...body, sha256 });
}
