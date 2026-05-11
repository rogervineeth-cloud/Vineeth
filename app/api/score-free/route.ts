// Free-tier ATS scoring endpoint. Deterministic. No LLM. No entitlement check.
//
// HARD RULE: this file MUST NOT import @anthropic-ai/sdk (or any LLM SDK).
// A jest test enforces this invariant — see __tests__/score-free.no-llm.test.ts.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scoreFree } from "@/lib/score-free";
import { isPricingV2Enabled } from "@/lib/feature-flags";

export const runtime = "nodejs";

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
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { resumeText, jdText } = parsed.data;
  const result = scoreFree(resumeText, jdText);
  return NextResponse.json(result);
}
