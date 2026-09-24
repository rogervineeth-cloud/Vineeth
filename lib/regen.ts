// Free regeneration: "Regenerating uses 1 credit (free within 24 h of the
// same JD)" — the promise the profile page makes when a user arrives from a
// resume preview.
//
// Pure helpers shared by the client (carrying the parent id from preview →
// profile → create) and the server (deciding whether it is free). The
// database walk lives in lib/plans.ts#canGenerateFreeRegen.
//
// PRODUCTION QA, 2026-09-23: a same-JD regeneration two minutes after the
// original was charged. The parent id never reached the server — the profile
// page's "generate a new resume" link was a bare /create, and the create page
// never sent regen_of_resume_id at all. The server side had its own gap:
// it checked only the parent's age, not the JD, so wiring the id through
// alone would have made ANY generation within 24 h of any resume free, and a
// regeneration of a regeneration would restart the window indefinitely.

export const FREE_REGEN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How far up a lineage chain to look for the paid original. */
export const MAX_LINEAGE_HOPS = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The regeneration parent carried in a URL (`?regen=<resume id>`), or null.
 * Anything that is not a well-formed UUID is dropped: the API rejects a
 * malformed id with a 400, and a bad link must never block generation.
 */
export function parseRegenParam(search: string): string | null {
  const v = new URLSearchParams(search).get("regen")?.trim() ?? "";
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** Where "generate a new resume" should go, keeping the parent if there is one. */
export function createHref(parentResumeId: string | null | undefined): string {
  const id = parentResumeId?.trim();
  return id && UUID_RE.test(id) ? `/create?regen=${encodeURIComponent(id.toLowerCase())}` : "/create";
}

/** JD identity for the free-regen rule: surrounding and repeated whitespace do not count. */
export function normaliseJd(jd: string | null | undefined): string {
  return (jd ?? "").trim().replace(/\s+/g, " ");
}

export type LineageNode = {
  jd_text: string | null;
  created_at: string;
  regen_of_resume_id?: string | null;
};

/**
 * Whether regenerating from `chain[0]` with `jdText` is free.
 *
 * `chain` is the parent followed by its ancestors, nearest first. It must
 * reach the top of the same-JD run: a truncated chain anchors later and so
 * is MORE lenient. canGenerateFreeRegen refuses when it hits the hop limit.
 *
 * Free requires the SAME JD as the parent, and the window is measured from
 * the earliest ancestor in the unbroken same-JD run — i.e. the generation
 * that was actually paid for. Without that anchor, regenerating a
 * regeneration would push the window forward forever.
 */
export function isFreeRegen(chain: LineageNode[], jdText: string, now: number = Date.now()): boolean {
  if (chain.length === 0) return false;
  const jd = normaliseJd(jdText);
  if (!jd || normaliseJd(chain[0].jd_text) !== jd) return false;

  let anchor = chain[0];
  for (const node of chain.slice(1)) {
    if (normaliseJd(node.jd_text) !== jd) break;
    anchor = node;
  }
  const created = new Date(anchor.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created < FREE_REGEN_WINDOW_MS;
}
