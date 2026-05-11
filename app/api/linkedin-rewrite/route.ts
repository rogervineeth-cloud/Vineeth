// LinkedIn Profile Rewrite endpoint.
// LLM IS allowed here — but only for users who hold an unused
// linkedin_rewrite entitlement. Same 402 pattern as /api/generate-resume.
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasAddonEntitlement, consumeAddon } from "@/lib/addons";
import { track } from "@/lib/analytics";
import { isPricingV2Enabled } from "@/lib/feature-flags";

export const maxDuration = 60;

const CREATOR_EMAIL = "rogervineeth@gmail.com";

const inputSchema = z.object({
  linkedin_url: z.string().url().optional().or(z.literal("")),
  current_text: z.string().min(50, "Paste at least 50 characters of your current LinkedIn content"),
  target_role: z.string().min(2),
});

const SYSTEM_PROMPT = `You rewrite Indian-market LinkedIn profiles for the target role provided. Indian English spelling. Keep it truthful — never invent jobs, employers, dates, or metrics not present in the user's content. Plain text, no emojis, no markdown.

Return ONLY this JSON, no preamble or fences:
{
  "headline": "max 120 chars, includes target role keyword verbatim",
  "about": "3-5 short paragraphs, first-person, max 1800 chars total",
  "experience": [
    { "company": "string from user content", "role": "string from user content", "summary": "2-3 line rewrite emphasising target_role keywords, truthful only" }
  ]
}
Produce exactly 3 entries in "experience" — pick the most relevant from the user's content. If fewer than 3 exist, repeat the strongest with different angles. Never fabricate companies.`;

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1);
  return raw.trim();
}

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
  const { linkedin_url, current_text, target_role } = parsed.data;

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const isCreator = session.user.email === CREATOR_EMAIL;

  if (!isCreator) {
    const ok = await hasAddonEntitlement(userId, "linkedin_rewrite");
    if (!ok) {
      track("generate_attempt_blocked_free", { user_id: userId, kind: "linkedin_rewrite" });
      return NextResponse.json(
        { error: "payment_required", reason: "NO_ADDON", checkoutUrl: "/pricing" },
        { status: 402 }
      );
    }
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20251101",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            target_role,
            linkedin_url: linkedin_url || null,
            current_text,
          }),
        },
      ],
    });
    const rawText = message.content[0].type === "text" ? message.content[0].text : "";
    let rewriteJson: unknown;
    try {
      rewriteJson = JSON.parse(extractJson(rawText));
    } catch {
      console.error("Failed to parse LinkedIn rewrite response:", rawText.slice(0, 500));
      return NextResponse.json({ error: "We hit a glitch rewriting your profile. Please try once more." }, { status: 500 });
    }

    if (!isCreator) {
      const consumed = await consumeAddon(userId, "linkedin_rewrite");
      if (!consumed) {
        return NextResponse.json(
          { error: "payment_required", reason: "NO_ADDON", checkoutUrl: "/pricing" },
          { status: 402 }
        );
      }
    }

    return NextResponse.json({ rewrite: rewriteJson });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("linkedin-rewrite error:", msg);
    return NextResponse.json({ error: "LinkedIn rewrite failed. Please try again." }, { status: 500 });
  }
}
