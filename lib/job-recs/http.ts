// Shared request plumbing for the /api/job-recommendations routes:
// feature flag (404 when off), verified session (401), per-instance rate
// limit (429), strict JSON body parsing (400), and no-store responses.

import { NextResponse } from "next/server";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isJobRecsEnabled } from "@/lib/job-recs/config";
import { hit, type Limit } from "@/lib/job-recs/rate-limit";
import type { ServiceResult } from "@/lib/job-recs/service";

const NO_STORE = { "Cache-Control": "no-store" };
export const MAX_BODY_BYTES = 2_048;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function respond(r: ServiceResult) {
  return json(r.body, r.status, r.headers);
}

type Guard = { ok: true; userId: string } | { ok: false; response: NextResponse };

export async function guard(limitKey: string, limit: Limit): Promise<Guard> {
  if (!isJobRecsEnabled()) return { ok: false, response: json({ error: "Not found" }, 404) };
  const supabase = await createClient();
  // getUser() revalidates the JWT with the auth server; getSession() only
  // decodes the cookie.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: json({ error: "Please sign in.", code: "unauthorized" }, 401) };
  const rl = hit(`${limitKey}:${user.id}`, limit);
  if (!rl.ok) {
    return {
      ok: false,
      response: json(
        { error: "Too many requests. Please slow down.", code: "rate_limited", retry_after: rl.retryAfter },
        429,
        { "Retry-After": String(rl.retryAfter) }
      ),
    };
  }
  return { ok: true, userId: user.id };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T):
  Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const bad = (msg: string) => ({ ok: false as const, response: json({ error: msg, code: "invalid_request" }, 400) });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return bad("Expected a JSON body.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return bad("Request body is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad("Request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return bad("Request body is invalid.");
  return { ok: true, data: parsed.data };
}

export function serverError(event: string, err: unknown) {
  // Error name only: messages from lower layers are not guaranteed free of data.
  console.error(`[job-recs] ${event}`, { error: err instanceof Error ? err.name : "unknown" });
  return json({ error: "Something went wrong. Please try again.", code: "server_error" }, 500);
}
