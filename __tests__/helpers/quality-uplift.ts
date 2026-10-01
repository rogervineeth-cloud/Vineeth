// The early-career quality uplift (headline, CGPA restored, summary evidence
// sentences, internship after education) changes every replayed capture on
// purpose. Older replay tests pin "only these scenarios change" for the guard
// they were written for; they compare with the uplift's own, separately
// tested, additions taken out, so they still catch any other drift.

type Json = Record<string, unknown>;
const SPLIT = /(?<=[.!?])\s+(?=[A-Z])/;
/** The sentences enrichEarlyCareerSummary composes. */
const ENRICHED = /^(?:Worked as .+ at .+|Built .+)\.$/;

function base(r: unknown): Json {
  const c = structuredClone(r) as Json;
  delete c.headline;
  for (const e of (c.education as Json[] | undefined) ?? []) {
    if ("gpa" in e) {
      e.cgpa = e.gpa;
      delete e.gpa;
    }
  }
  return c;
}

/** [captured, replayed], each without the uplift's additions. */
export function withoutQualityUplift(captured: unknown, replayed: unknown): [Json, Json] {
  const a = base(captured);
  const b = base(replayed);
  // orderEarlyCareerSections: an intern's experience moved up to follow education.
  if (Array.isArray(a.section_order) && Array.isArray(b.section_order)) {
    const without = (o: unknown[]) => JSON.stringify(o.filter((x) => x !== "experience"));
    const bo = b.section_order as string[];
    if (without(a.section_order) === without(bo) && bo[bo.indexOf("experience") - 1] === "education") {
      b.section_order = a.section_order;
    }
  }
  if (typeof a.summary === "string" && typeof b.summary === "string") {
    const was = new Set(a.summary.split(SPLIT));
    b.summary = b.summary.split(SPLIT).filter((s) => was.has(s) || !ENRICHED.test(s)).join(" ");
  }
  return [a, b];
}

export function changedBeyondUplift(captured: unknown, replayed: unknown): boolean {
  const [a, b] = withoutQualityUplift(captured, replayed);
  return JSON.stringify(a) !== JSON.stringify(b);
}
