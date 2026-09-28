import { z } from "zod";
import { guard, parseBody, respond, serverError } from "@/lib/job-recs/http";
import { LIMITS } from "@/lib/job-recs/rate-limit";
import { createJobRecs, getJobRecs } from "@/lib/job-recs/service";
import { supabaseJobRecStore } from "@/lib/job-recs/store";

// GET  /api/job-recommendations — the caller's current state and latest run.
// POST /api/job-recommendations — create a run. Body: { request_key: uuid }.
//   The browser makes one request_key per click and reuses it only to retry,
//   so a retry returns the same run instead of calling the provider again.
// Off (404) unless JOB_RECOMMENDATIONS_ENABLED=true. See lib/job-recs/config.ts.
export const maxDuration = 30;

const createSchema = z.object({ request_key: z.string().uuid() }).strict();

export async function GET() {
  const g = await guard("read", LIMITS.read);
  if (!g.ok) return g.response;
  try {
    return respond(await getJobRecs(g.userId, { store: supabaseJobRecStore() }));
  } catch (err) {
    return serverError("get_failed", err);
  }
}

export async function POST(req: Request) {
  const g = await guard("create", LIMITS.create);
  if (!g.ok) return g.response;
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  try {
    return respond(await createJobRecs(g.userId, body.data.request_key, { store: supabaseJobRecStore() }));
  } catch (err) {
    return serverError("create_failed", err);
  }
}
