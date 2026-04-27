import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const inputSchema = z.object({
  jd_text: z.string().min(100, "Job description too short (min 100 chars)"),
  target_roles: z.array(z.string()).optional(),
  existing_experience: z
    .array(
      z.object({
        company: z.string().optional(),
        role: z.string().optional(),
        duration: z.string().optional(),
      })
    )
    .optional(),
});

const SYSTEM_PROMPT = `You are an expert resume writer for the Indian job market. Given a job description, suggest 4-6 strong, generic experience bullet points the candidate could ADAPT to their own work history.

Rules:
- Each bullet starts with a strong action verb (Led, Built, Designed, Implemented, Delivered, Scaled, Reduced, Grew, Owned, Drove, Shipped, etc.). Never "Responsible for" or "Worked on".
- Each bullet is 1-2 lines max.
- Weave in 1-2 JD keywords per bullet naturally — do not stuff.
- Include a placeholder metric in square brackets when natural — e.g. "by [X]%", "for [N] users", "saving ~[N] hrs/week" — so the user can fill in their real numbers.
- Do NOT fabricate companies, dates, or specifics. These are template starters the user will personalise.

Return ONLY valid JSON, no preamble, no markdown fences:

{
  "bullets": ["bullet 1", "bullet 2", ...],
  "keywords_used": ["keyword1", "keyword2", ...]
}`;

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jd_text, target_roles, existing_experience } = parsed.data;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            jd_text,
            target_roles: target_roles ?? [],
            existing_experience: existing_experience ?? [],
          }),
        },
      ],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";

    let json: { bullets?: unknown; keywords_used?: unknown };
    try {
      json = JSON.parse(extractJson(rawText));
    } catch {
      console.error("suggest-experience parse failure:", rawText.slice(0, 500));
      return NextResponse.json(
        { error: "We couldn't draft suggestions. Please try once more." },
        { status: 500 }
      );
    }

    const bullets = Array.isArray(json.bullets)
      ? (json.bullets as unknown[]).filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      : [];
    const keywords_used = Array.isArray(json.keywords_used)
      ? (json.keywords_used as unknown[]).filter((k): k is string => typeof k === "string")
      : [];

    if (bullets.length === 0) {
      return NextResponse.json(
        { error: "We couldn't draft suggestions. Please try once more." },
        { status: 500 }
      );
    }

    return NextResponse.json({ bullets, keywords_used });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("suggest-experience error:", msg);
    if (msg.includes("401") || msg.includes("authentication") || msg.includes("API key")) {
      return NextResponse.json({ error: "Configuration error. Please contact support." }, { status: 500 });
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      return NextResponse.json({ error: "Request timed out — please try again." }, { status: 500 });
    }
    return NextResponse.json({ error: "Couldn't generate suggestions. Please try again." }, { status: 500 });
  }
}
