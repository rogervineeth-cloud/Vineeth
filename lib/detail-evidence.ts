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
    if (opts.summary && w === "systems" && headNounOnEvidence(rewrite, w, evidence)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * "experience in embedded systems" for a candidate who tested "embedded
 * devices" (final-live-5 S09): the generic head noun names no new fact when
 * the word it heads is the candidate's own. Every occurrence must be headed by
 * an evidenced content word, so "scalable systems" (and a JD skill such as
 * "distributed systems", which the skill guard also checks) stays novel.
 */
export function headNounOnEvidence(text: string, noun: string, evidence: Evidence): boolean {
  const found = [...(text ?? "").toLowerCase().matchAll(new RegExp(`(?:^|[^a-z0-9+#-])([a-z0-9+#-]+)\\s+${noun}\\b`, "g"))];
  const total = ((text ?? "").toLowerCase().match(new RegExp(`\\b${noun}\\b`, "g")) ?? []).length;
  return found.length === total && found.every((m) => !STOP.has(m[1]) && contentTokens(m[1]).length > 0 && contentTokens(m[1]).every((w) => evidence.has(w)));
}

// ── Trim instead of revert ─────────────────────────────────────────────────
//
// Offline corpus audit (evals/resume-quality/offline-corpus, baseline): a
// rewrite with ONE unsupported word or clause — "..., improving overall
// ROAS", "through data-driven creative testing", "customer-facing macros" —
// was reverted whole, so the truthful tailoring around it was lost (0 of 22
// such items kept any). Here only the unsupported part goes, and only when
// what is left passes the same evidence check, keeps every number of the
// candidate's source text and still mostly says what the source said.
// Otherwise the caller reverts exactly as before.

/** Where a removable clause may start: ", improving ...", " and optimising ...", " by/using/through/via/with/as ...", " to deepen ...", "; ...". */
const CLAUSE_STARTS = [
  /,\s+(?:and\s+|while\s+|thereby\s+)?[a-z]+ing\b/gi,
  /\s+(?:and|while)\s+[a-z]+ing\b/gi,
  /,?\s+(?:by|using|through|via|with|as)\s+/gi,
  // Purpose clause: "Seeking the SDE II role to deepen expertise in ...".
  /\s+to\s+(?!\d)[a-z]+\b/gi,
  /;\s+/g,
];

export type TrimOptions = {
  /** Unsupported words (or skills) still in `t`; empty means supported. */
  novel: (t: string) => string[];
  /** Any further check the result must pass. */
  ok?: (t: string) => boolean;
  /** The candidate's own text this was rewritten from, if known. */
  source?: string;
  /** Only remove clauses (for checks that report skills, not words). */
  clausesOnly?: boolean;
};

const numbersIn = (t: string) => new Set((t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []));

/** Share of the source's content words the result still carries. */
function coverage(result: string, source: string): number {
  const have = new Evidence(result);
  const src = [...new Set(contentTokens(source))];
  return src.length ? src.filter((w) => have.has(w)).length / src.length : 1;
}

/** Ends in a clause that lost its object ("... and partnering") or on a function word. */
function dangling(t: string): boolean {
  const words = t.replace(/[.!?]$/, "").trim().split(/\s+/);
  const last = (words[words.length - 1] ?? "").toLowerCase().replace(/[^a-z-]/g, "");
  const prev = (words[words.length - 2] ?? "").toLowerCase();
  return STOP.has(last) || (/ing$/.test(last) && (prev === "and" || prev.endsWith(",")));
}

function tidy(t: string): string {
  const s = t.replace(/\s+([,;.])/g, "$1").replace(/([,;])\s*([,;])/g, "$1").replace(/[,;]\s*$/, "").replace(/\s{2,}/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ", C++, and test automation" — the rest of a comma-separated list. */
const LIST_TAIL = /^,\s*[^,;]+(?:,\s*[^,;]+)*,?\s+(?:and|or)\s+\S/i;

/**
 * A role or noun phrase followed directly by a bare list ("...role at Google
 * Cloud, C++, and test automation") — a list that lost its introducing
 * clause.
 */
export const LIST_FRAGMENT =
  /\b(?:role|position|opportunity|opening)\b(?:\s+(?:at|with|in)\s+[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)?,\s+(?!(?:with|bringing|including|where|which|who|to|and|using|building|focusing|applying)\b)[^,.;]+,\s*(?:and|or)\s/i;

function clauseRemovals(body: string): string[] {
  const out: string[] = [];
  for (const re of CLAUSE_STARTS) {
    for (const m of body.matchAll(re)) {
      const s = m.index ?? 0;
      if (s === 0) continue;
      const rest = body.slice(s + 1);
      const next = rest.search(/[,;]/);
      const ends = [body.length];
      // Never stop a cut inside a list: after ", bringing expertise in
      // Python" comes ", C++, and test automation", and cutting only to that
      // comma left "...role at Google Cloud, C++, and test automation."
      // (final-live-4 S09). A cut that ends where a list continues goes to
      // the end of the sentence instead.
      if (next >= 0 && !LIST_TAIL.test(body.slice(s + 1 + next))) ends.push(s + 1 + next);
      for (const e of ends) out.push(body.slice(0, s) + body.slice(e));
    }
  }
  return out;
}

function modifierRemovals(body: string, novelWords: Set<string>): string[] {
  const toks = body.split(/\s+/);
  const out: string[] = [];
  toks.forEach((tok, i) => {
    if (/[,;:]$/.test(tok)) return;
    const word = tok.toLowerCase().replace(/[^a-z0-9+#-]/g, "");
    const hyphenated = word.includes("-");
    if (!contentTokens(word).some((w) => novelWords.has(w))) return;
    // Plain -ed/-ing words may be verbs ("optimised queries"); only
    // hyphenated compounds may go from the front of the sentence.
    if (!hyphenated && (/(?:ed|ing)$/.test(word) || i === 0)) return;
    const next = toks[i + 1];
    if (!next) return;
    // "PPAP and APQP files": deleting one of a coordination leaves "PPAP and files".
    const prev = (toks[i - 1] ?? "").toLowerCase();
    if (!/ly$/.test(word) && (prev === "and" || prev === "or" || prev === "&" || prev.endsWith(","))) return;
    const nextWords = contentTokens(next);
    if (nextWords.length === 0 || nextWords.some((w) => novelWords.has(w))) return;
    out.push(toks.filter((_, j) => j !== i).join(" "));
  });
  return out;
}

/** Past-tense opening verb ("Prepared", "Built", "Ran"). */
const PAST_VERB = /^(?:[a-z]+ed|built|ran|led|wrote|made|cut|sold|taught|won|grew|drove|set|began|brought|kept|held|met|put|sent|spent|took|gave|found|saw|told|thought|understood|oversaw|rebuilt|rewrote)$/i;

function verbRestore(body: string, source: string, novelWords: Set<string>): string[] {
  const first = body.split(/\s+/)[0] ?? "";
  const srcFirst = source.trim().split(/\s+/)[0] ?? "";
  // Only a verb for a verb: "Prepared weekly reports" -> "Built weekly reports".
  if (!PAST_VERB.test(first) || !PAST_VERB.test(srcFirst)) return [];
  if (!contentTokens(first).some((w) => novelWords.has(w))) return [];
  return [srcFirst + body.slice(first.length)];
}

/**
 * The rewrite with its unsupported word(s)/clause(s) removed, or null when no
 * removal of at most three steps yields supported, well-formed text that
 * keeps the source's numbers and at least 75% of its content words.
 */
export function trimToEvidence(text: string, o: TrimOptions): string | null {
  const trimmed = text.trim();
  const end = /[.!?]$/.test(trimmed) ? trimmed.slice(-1) : "";
  const finish = (b: string) => tidy(b) + end;
  const srcNumbers = o.source ? numbersIn(o.source) : new Set<string>();
  const accept = (b: string) => {
    const t = finish(b);
    if (contentTokens(t).length < 2 || dangling(t)) return false;
    if (o.novel(t).length) return false;
    if (o.ok && !o.ok(t)) return false;
    if (o.source) {
      const have = numbersIn(t);
      if (![...srcNumbers].every((n) => have.has(n))) return false;
      // Trimming must not say less of the candidate's own bullet than a
      // revert would: "Reduced dispatch errors from 3.2% to 0.9%" drops their
      // "by introducing barcode scanning at packing", so revert instead.
      if (coverage(t, o.source) < 0.75) return false;
    }
    return true;
  };

  let frontier = [trimmed.replace(/[.!?]$/, "")];
  const seen = new Set(frontier);
  for (let depth = 0; depth < 3; depth++) {
    const next: string[] = [];
    for (const b of frontier) {
      const novelWords = new Set(o.clausesOnly ? [] : o.novel(finish(b)).map((w) => w.toLowerCase()));
      const children = [
        ...clauseRemovals(b),
        ...(o.clausesOnly ? [] : modifierRemovals(b, novelWords)),
        ...(o.clausesOnly || !o.source ? [] : verbRestore(b, o.source, novelWords)),
      ];
      for (const c of children) {
        const k = tidy(c);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(c);
      }
    }
    const ok = next.filter(accept).sort((a, b) => tidy(b).length - tidy(a).length);
    if (ok.length) return finish(ok[0]);
    frontier = next.slice(0, 200);
  }
  return null;
}
