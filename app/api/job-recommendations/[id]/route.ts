import { z } from "zod";
import { guard, json, parseBody, respond, serverError } from "@/lib/job-recs/http";
import { LIMITS } from "@/lib/job-recs/rate-limit";
import { setRecStatus } from "@/lib/job-recs/service";
import { supabaseJobRecStore } from "@/lib/job-recs/store";

// PATCH /api/job-recommendations/:id — { action: "save" | "dismiss" | "reset" }.
// Idempotent (sets a status). Only the caller's own recommendation can change:
// the update is scoped by the session's user id, and another user's id is a 404.
const schema = z.object({ action: z.enum(["save", "dismiss", "reset"]) }).strict();
const STATUS = { save: "saved", dismiss: "dismissed", reset: "new" } as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("mutate", LIMITS.mutate);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "Recommendation not found.", code: "not_found" }, 404);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    return respond(await setRecStatus(g.userId, id, STATUS[body.data.action], { store: supabaseJobRecStore() }));
  } catch (err) {
    return serverError("status_failed", err);
  }
}
