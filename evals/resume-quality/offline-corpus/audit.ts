// Offline guard audit over a synthetic, domain-diverse corpus.
//
//   npx tsx evals/resume-quality/offline-corpus/audit.ts [--save <label>]
//
// Every case is a FICTIONAL composite: an invented candidate (example.com
// email, invented employers and colleges), a synthetic JD, and a hand-written
// "model-style" rewrite whose items are labelled by what they do:
//
//   faithful           same content, neutral wording          -> must survive unchanged
//   tailored           reordered / JD-aligned, all evidenced  -> must survive unchanged
//   verb_swap          truthful but a different opening verb  -> should keep the tailoring
//   truthful_unscoped  truthful, but uses words its own role does not
//                      (a synonym, or evidence from another field) -> the guard cannot
//                      know; reverting it is a measured cost, not a leak
//   one_unsupported    truthful tailoring + ONE unsupported word or clause
//                      -> should lose only that word/clause
//   fabricated         several unsupported claims            -> must not survive
//
// There is no model here: the audit measures what production post-processing
// (lib/resume-generation.ts#postProcessResume) does to known inputs. Outcomes
// are judged with the evaluator's own, separately implemented checks.
//
// The corpus and the guards were written by the same author. The items show
// the mechanism and its limits; they are not a sample of real model output
// and say nothing about real-world rates.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { postProcessResume, type GenerationProfile } from "@/lib/resume-generation";
import { usableSections } from "@/lib/profile-completeness";
import { computeFacts } from "@/lib/profile-facts";
import {
  evaluateResume,
  addedWords,
  wordSet,
  NEUTRAL,
  SUMMARY_NEUTRAL,
  type ProfileFixture,
  type JdFixture,
  type Scenario,
  type GeneratedResume,
} from "../evaluate";

export const CORPUS_DIR = join(__dirname, "cases");
export const CORPUS_NOW = new Date("2026-09-24T12:00:00Z");

export type Kind = "faithful" | "tailored" | "verb_swap" | "truthful_unscoped" | "one_unsupported" | "fabricated";
export const KINDS: Kind[] = ["faithful", "tailored", "verb_swap", "truthful_unscoped", "one_unsupported", "fabricated"];

type Label = { where: "bullet" | "project" | "summary"; role?: number; source?: number; project?: number; text: string; kind: Kind; note?: string };

export type CorpusCase = {
  id: string;
  domain: string;
  expected_fit: Scenario["expected_fit"];
  facts: ProfileFixture["facts"];
  profile: ProfileFixture["user_profile"];
  jd: { title: string; text: string };
  output: GeneratedResume;
  labels: Label[];
};

export type ItemResult = {
  case: string;
  where: Label["where"];
  kind: Kind;
  input: string;
  final: string;
  outcome: "kept" | "trimmed" | "reverted" | "dropped";
  /** No unsupported content left (evaluator's independent check). */
  clean: boolean;
  /** Every number of the source item is still present. */
  achievements_kept: boolean;
  /** Something of the rewrite beyond the candidate's own text survived, cleanly. */
  tailoring_retained: boolean;
};

export type CaseResult = {
  id: string;
  domain: string;
  gates: Record<string, boolean>;
  defects: string[];
  summary: string;
  summary_names_target: boolean;
  summary_fell_back: boolean;
  source_achievements_preserved: boolean;
  items: ItemResult[];
};

export function loadCorpus(): CorpusCase[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CORPUS_DIR, f), "utf8")) as CorpusCase);
}

const numbers = (t: string) => new Set((t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []));
const subset = <T>(a: Set<T>, b: Set<T>) => [...a].every((x) => b.has(x));
const sentences = (t: string) => (t ?? "").trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
const contentWords = (t: string) => new Set((t ?? "").toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2));

function fixtures(c: CorpusCase) {
  const profile = structuredClone(c.profile) as GenerationProfile & ProfileFixture["user_profile"];
  Object.assign(profile, usableSections(profile));
  const pf: ProfileFixture = { id: c.id, label: c.domain, facts_as_of: "2026-09-24", facts: c.facts, user_profile: profile };
  const jd: JdFixture = {
    id: c.id, company: "(synthetic)", title: c.jd.title, url: "", source_status: "SYNTHETIC",
    expected: { level: "", min_years: null, ground_truth_skills: [] }, text: c.jd.text,
  };
  const scenario: Scenario = { id: c.id, profile: c.id, jd: c.id, expected_fit: c.expected_fit, why: "synthetic" };
  return { profile, pf, jd, scenario };
}

export function auditCase(c: CorpusCase, now: Date = CORPUS_NOW): CaseResult {
  const { profile, pf, jd, scenario } = fixtures(c);
  const full = postProcessResume(structuredClone(c.output), profile, { now });
  const r = full.resume as GeneratedResume;
  const ev = evaluateResume(pf, jd, scenario, r, now);
  const exp = profile.experience ?? [];

  const items: ItemResult[] = [];
  for (const l of c.labels) {
    if (l.where === "summary") {
      const finals = sentences(r.summary ?? "");
      // Neither the candidate's own summary nor the computed identity sentence
      // counts as a trimmed version of the model's sentence.
      const own = new Set([...sentences(profile.summary ?? ""), computeFacts(profile, now).identity]);
      const lw = contentWords(l.text);
      const exact = finals.includes(l.text);
      const trimmed = !exact
        ? finals.find((s) => !own.has(s) && contentWords(s).size >= 3 && subset(contentWords(s), lw))
        : undefined;
      const final = exact ? l.text : trimmed ?? "";
      const scope = wordSet([profile.summary ?? "", ...(profile.skills ?? []),
        ...exp.flatMap((e) => [e.role, e.company, ...e.bullets]),
        ...(profile.education ?? []).flatMap((e) => [e.degree, e.institution]),
        ...(profile.projects ?? []).flatMap((p) => [p.name, p.description, ...p.tech]),
        c.jd.title, r.tailored_role ?? ""].join(" "));
      const clean = final === "" || addedWords(final, scope, SUMMARY_NEUTRAL).length === 0;
      items.push({
        case: c.id, where: "summary", kind: l.kind, input: l.text, final,
        outcome: exact ? "kept" : trimmed ? "trimmed" : "dropped",
        clean, achievements_kept: true, tailoring_retained: final !== "" && clean,
      });
      continue;
    }

    let source = "";
    let scopeText = "";
    let final = "";
    if (l.where === "bullet") {
      const role = exp[l.role!];
      source = role.bullets[l.source!];
      scopeText = [role.role, role.company, ...role.bullets].join(" ");
      const one = postProcessResume(
        { experience: [{ company: role.company, role: role.role, duration: role.duration, bullets: [l.text] }] },
        profile, { now }
      ).resume as GeneratedResume;
      final = one.experience?.[0]?.bullets?.[0] ?? "";
    } else {
      const p = profile.projects![l.project!];
      source = p.description;
      scopeText = [p.name, p.description, ...p.tech].join(" ");
      const one = postProcessResume({ projects: [{ name: p.name, description: l.text, tech: p.tech }] }, profile, { now }).resume as GeneratedResume;
      final = one.projects?.[0]?.description ?? "";
    }
    const clean = final === "" || addedWords(final, wordSet(scopeText), NEUTRAL).length === 0;
    const outcome = final === l.text ? "kept" : final === source ? "reverted" : final === "" ? "dropped" : "trimmed";
    items.push({
      case: c.id, where: l.where, kind: l.kind, input: l.text, final, outcome, clean,
      achievements_kept: final !== "" && subset(numbers(source), numbers(final)),
      tailoring_retained: final !== "" && final !== source && clean,
    });
  }

  // Whole-resume achievement preservation: every number of every source
  // bullet of a role that is in the output survives in that role's bullets.
  let preserved = true;
  for (const e of r.experience ?? []) {
    const src = exp.find((x) => x.company === e.company && x.role === e.role);
    if (!src) continue;
    const have = numbers((e.bullets ?? []).join(" "));
    for (const b of src.bullets) if (!subset(numbers(b), have)) preserved = false;
  }

  return {
    id: c.id,
    domain: c.domain,
    gates: Object.fromEntries(ev.gates.map((g) => [g.gate, g.pass])),
    defects: ev.gates.flatMap((g) => g.defects.map((d) => `[${g.gate}] ${d}`)),
    summary: r.summary ?? "",
    summary_names_target: (r.summary ?? "").toLowerCase().includes(c.jd.title.toLowerCase()),
    summary_fell_back: full.warnings.includes("summary_fell_back_to_profile_summary"),
    source_achievements_preserved: preserved,
    items,
  };
}

export type KindStats = { n: number; kept: number; trimmed: number; reverted: number; dropped: number; leaks: number; retained: number; achievements_kept: number };

export function aggregate(results: CaseResult[]) {
  const items = results.flatMap((r) => r.items);
  const byKind = Object.fromEntries(KINDS.map((k) => {
    const xs = items.filter((i) => i.kind === k);
    const s: KindStats = {
      n: xs.length,
      kept: xs.filter((i) => i.outcome === "kept").length,
      trimmed: xs.filter((i) => i.outcome === "trimmed").length,
      reverted: xs.filter((i) => i.outcome === "reverted").length,
      dropped: xs.filter((i) => i.outcome === "dropped").length,
      leaks: xs.filter((i) => !i.clean).length,
      retained: xs.filter((i) => i.tailoring_retained).length,
      achievements_kept: xs.filter((i) => i.where !== "summary" && i.achievements_kept).length,
    };
    return [k, s];
  })) as Record<Kind, KindStats>;
  const gateNames = [...new Set(results.flatMap((r) => Object.keys(r.gates)))];
  return {
    cases: results.length,
    items: items.length,
    byKind,
    gates: Object.fromEntries(gateNames.map((g) => [g, results.filter((r) => r.gates[g]).length])),
    summary_names_target: results.filter((r) => r.summary_names_target).length,
    summary_fell_back: results.filter((r) => r.summary_fell_back).length,
    source_achievements_preserved: results.filter((r) => r.source_achievements_preserved).length,
    /** Items whose content should survive (all but fabricated) that lost it all. */
    over_reverted: items.filter((i) => i.kind !== "fabricated" && !i.tailoring_retained && i.outcome !== "kept").length,
  };
}

function toMarkdown(label: string, results: CaseResult[]): string {
  const a = aggregate(results);
  const L: string[] = [`# Offline guard audit — ${label}`, ""];
  L.push(`Synthetic, fictional corpus: ${a.cases} cases, ${a.items} labelled items. Post-processing = production \`postProcessResume\`; judged with the evaluator's independent checks. Not real model output; not evidence of real-world rates.`, "");
  L.push("## By item kind", "", "| Kind | n | kept | trimmed | reverted | dropped | unsupported left (leak) | tailoring retained | source numbers kept (bullets/projects) |", "|---|---|---|---|---|---|---|---|---|");
  for (const k of KINDS) {
    const s = a.byKind[k];
    const bp = results.flatMap((r) => r.items).filter((i) => i.kind === k && i.where !== "summary").length;
    L.push(`| ${k} | ${s.n} | ${s.kept} | ${s.trimmed} | ${s.reverted} | ${s.dropped} | ${s.leaks} | ${s.retained} | ${s.achievements_kept}/${bp} |`);
  }
  L.push("", "## Case level", "", `- Gates passing (of ${a.cases}): ${Object.entries(a.gates).map(([g, n]) => `${g} ${n}`).join(", ")}`);
  L.push(`- Summary names the target role: ${a.summary_names_target}/${a.cases}; summary fell back to the candidate's own: ${a.summary_fell_back}/${a.cases}`);
  L.push(`- Every source bullet's numbers preserved in the full resume: ${a.source_achievements_preserved}/${a.cases}`);
  L.push(`- Items that should keep content but lost all tailoring: ${a.over_reverted}`, "");
  L.push("## Items", "", "| Case | Where | Kind | Outcome | Clean | Final |", "|---|---|---|---|---|---|");
  for (const r of results) for (const i of r.items) L.push(`| ${i.case} | ${i.where} | ${i.kind} | ${i.outcome} | ${i.clean ? "yes" : "**NO**"} | ${i.final.replace(/\|/g, "/") || "—"} |`);
  const defects = results.flatMap((r) => r.defects.map((d) => `- **${r.id}** ${d}`));
  if (defects.length) L.push("", "## Evaluator defects on the full resumes", "", ...defects);
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const results = loadCorpus().map((c) => auditCase(c));
  const i = process.argv.indexOf("--save");
  const label = i >= 0 ? process.argv[i + 1] : "latest";
  const md = toMarkdown(label, results);
  console.log(md);
  if (i >= 0) {
    const dir = join(__dirname, "..", "results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}.md`), md);
    writeFileSync(join(dir, `${label}.json`), JSON.stringify({ label, aggregate: aggregate(results), cases: results }, null, 2) + "\n");
  }
}
