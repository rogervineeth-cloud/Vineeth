import { z } from "zod";
import { guard, parseBody, respond, serverError } from "@/lib/job-recs/http";
import { LIMITS } from "@/lib/job-recs/rate-limit";
import { setConsent } from "@/lib/job-recs/service";
import { supabaseJobRecStore } from "@/lib/job-recs/store";

// POST /api/job-recommendations/consent — { action: "grant" | "revoke" }.
// Revoking also deletes every run and recommendation stored for the caller.
const schema = z.object({ action: z.enum(["grant", "revoke"]) }).strict();

export async function POST(req: Request) {
  const g = await guard("mutate", LIMITS.mutate);
  if (!g.ok) return g.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    return respond(await setConsent(g.userId, body.data.action, { store: supabaseJobRecStore() }));
  } catch (err) {
    return serverError("consent_failed", err);
  }
}
