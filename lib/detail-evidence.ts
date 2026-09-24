// "Rephrase, don't elaborate" — detail evidence for rewritten resume text.
//
// The skill guard only knows named skills. The final live run
// (evals/resume-quality/captured/live-final) still passed it with invented
// execution detail: "Automated nightly reconciliation reports using Spring
// Boot batch jobs" (the candidate wrote "Automated nightly reconciliation
// reports, saving the operations team 6 hours a week"), "…using Java batch
// processing", "…by implementing Redis caching and optimising query
// patterns", "improving deployment velocity and system resilience". Each is
// a method, component or outcome an interviewer can ask about and the
// candidate never claimed.
//
// Rather than ban those phrases, a rewrite is compared with its evidence: a
// content word it adds must already appear in the text it was rewritten from
// (for a bullet, its own role — title, company and bullets; for a project,
// that project). Only neutral presentation words may be new: function words,
// time units, and plain execution verbs ("built", "wrote", "fixed"). Verbs
// that add scope or ownership ("architected", "led", "spearheaded") and
// outcome verbs ("improving", "ensuring", "enabling") are content.

const STOP = new Set(
  (
    "a an the and or but nor of to for with without in on at by from into onto over under across via per as " +
    "that which who whom whose this these those it its their them they he she his her our we us you your " +
    "is are was were be been being has have had do does did done can could will would should may might must " +
    "also then than so such both each every all any more most other same own very just only not no " +
    "while during through throughout within between among after before until since about around against " +
    "up down out off again further here there when where how what why including using used use"
  ).split(" ")
);

/** Neutral presentation words a rewrite may add. */
const PRESENTATION = new Set(
  (
    // plain execution verbs
    "build built building develop developed developing implement implemented implementing create created " +
    "write wrote written writing author authored deliver delivered complete completed execute executed " +
    "conduct conducted perform performed run ran running fix fixed resolve resolved add added " +
    "reduce reduced reducing cut cutting lower lowered decrease decreased collaborate collaborated " +
    "collaborating partner partnered work worked working " +
    // units and quantity words (numbers themselves are grounded by the sanitiser)
    "ms millisecond milliseconds second seconds minute minutes hour hours day days daily week weeks weekly " +
    "month months monthly year years yearly annual annually million millions thousand lakh lakhs crore crores " +
    "percent approximately approx roughly over nearly"
  ).split(" ")
);

/** Words a summary may add around the candidate's own facts. */
export const SUMMARY_PRESENTATION = new Set(
  (
    "experience experienced professional seeking targeting pursuing applying role roles position opportunity " +
    "graduate graduated fresher student candidate background career focus focused focusing development " +
    "engineering software currently hands"
  ).split(" ")
);

export function contentTokens(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .split(" ")
    // Numbers are the sanitiser's job (per-entry metric grounding).
    .filter((w) => w.length >= 2 && /[a-z]/.test(w) && !STOP.has(w));
}

const SUFFIXES = [
  "ations", "ation", "ions", "ion", "ments", "ment", "ings", "ing", "ers", "er",
  "ies", "ied", "ful", "ed", "es", "s", "ly", "e",
];

/** Crude stem variants; two words match when their variant sets intersect. */
export function stemVariants(word: string): Set<string> {
  const w = word.replace(/iz/g, "is").replace(/yz/g, "ys");
  const out = new Set([w]);
  for (const suf of SUFFIXES) {
    if (!w.endsWith(suf) || w.length - suf.length < 3) continue;
    let v = w.slice(0, -suf.length);
    if (suf === "ies" || suf === "ied") v += "y";
    out.add(v);
    if (v.endsWith("e") && v.length > 3) out.add(v.slice(0, -1));
    if (/([b-df-hj-np-tv-z])\1$/.test(v)) out.add(v.slice(0, -1));
  }
  return out;
}

export class Evidence {
  private stems = new Set<string>();
  constructor(...texts: string[]) {
    for (const t of texts) this.add(t);
  }
  add(text: string) {
    for (const w of contentTokens(text)) for (const s of stemVariants(w)) this.stems.add(s);
    return this;
  }
  has(word: string): boolean {
    for (const s of stemVariants(word)) if (this.stems.has(s)) return true;
    return false;
  }
}

const PRESENTATION_EVIDENCE = new Evidence([...PRESENTATION].join(" "));
const SUMMARY_EVIDENCE = new Evidence([...SUMMARY_PRESENTATION].join(" "));

/**
 * Content words in `rewrite` that neither its evidence nor the neutral
 * presentation vocabulary supports. Empty means the rewrite only rephrases.
 */
export function novelDetail(rewrite: string, evidence: Evidence, opts: { summary?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const w of contentTokens(rewrite)) {
    if (evidence.has(w) || PRESENTATION_EVIDENCE.has(w)) continue;
    if (opts.summary && SUMMARY_EVIDENCE.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
