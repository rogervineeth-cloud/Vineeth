/**
 * Offline corpus audit (evals/resume-quality/offline-corpus): 12 FICTIONAL,
 * domain-diverse cases, mostly non-engineering, with hand-labelled rewrites.
 *
 * These tests use only production entry points that existed before the
 * trimming change (postProcessResume, opensWithIdentity) and the audit, so
 * they can be run against the previous guards: on those, the tailoring,
 * role-relevance, achievement and advice-count tests fail (see
 * results/offline-corpus-before.md); the safety tests pass on both.
 *
 * The corpus and the guards share an author; this pins the mechanisms, it
 * does not measure real-world rates.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume, opensWithIdentity } from "@/lib/resume-generation";
import { computeFacts } from "@/lib/profile-facts";
import { usableSections } from "@/lib/profile-completeness";
import { loadCorpus, auditCase, aggregate, CORPUS_NOW, type CorpusCase } from "../evals/resume-quality/offline-corpus/audit";
import { evaluateResume, type ProfileFixture, type JdFixture, type Scenario, type GeneratedResume } from "../evals/resume-quality/evaluate";

const corpus = loadCorpus();
const results = corpus.map((c) => auditCase(c));
const agg = aggregate(results);
const item = (id: string, input: RegExp) => results.find((r) => r.id === id)!.items.find((i) => input.test(i.input))!;

describe("the corpus is fictional and internally consistent", () => {
  it("has 12 cases across distinct domains, most of them non-engineering", () => {
    expect(corpus).toHaveLength(12);
    expect(new Set(corpus.map((c) => c.domain)).size).toBe(12);
  });

  it.each(corpus.map((c) => [c.id, c] as [string, CorpusCase]))("%s: fictional person, example.com email", (_id, c) => {
    expect(c.profile.full_name).toMatch(/\(fictional\)$/);
    expect(c.profile.email).toMatch(/@example\.com$/);
  });

  it.each(corpus.map((c) => [c.id, c] as [string, CorpusCase]))("%s: facts match the durations", (_id, c) => {
    expect(computeFacts(c.profile, CORPUS_NOW).professional_years).toBe(c.facts.professional_years);
  });
});

describe("safety holds before and after (no unsupported content survives)", () => {
  it("no labelled item leaves unsupported content, by the evaluator's independent check", () => {
    expect(results.flatMap((r) => r.items).filter((i) => !i.clean)).toEqual([]);
  });

  it("faithful and tailored items survive unchanged", () => {
    for (const k of ["faithful", "tailored"] as const) expect(agg.byKind[k].kept).toBe(agg.byKind[k].n);
  });

  it("fabricated items never keep their fabrication", () => {
    expect(agg.byKind.fabricated.retained).toBe(0);
    expect(agg.byKind.fabricated.leaks).toBe(0);
  });

  it("factual and detail fidelity pass on every full resume", () => {
    expect(agg.gates.factual_fidelity).toBe(12);
    expect(agg.gates.detail_fidelity).toBe(12);
  });
});

describe("tailoring survives when only one word or clause is unsupported (failed before)", () => {
  it("most one-unsupported items keep their truthful tailoring (0/22 before)", () => {
    expect(agg.byKind.one_unsupported.retained).toBeGreaterThanOrEqual(15);
    expect(agg.byKind.one_unsupported.leaks).toBe(0);
  });

  it("a trailing outcome clause goes, the reordered rest stays (N01)", () => {
    expect(item("N01", /^Reduced cost per acquisition/).final).toBe(
      "Reduced cost per acquisition from Rs 640 to Rs 410 by testing 25 creatives and restructuring ad sets."
    );
  });

  it("an unsupported coordinated clause goes without leaving a dangling verb (N03)", () => {
    expect(item("N03", /^Sourced candidates/).final).toBe("Sourced candidates on LinkedIn Recruiter and Naukri, screening 60 profiles a week.");
  });

  it("an unsupported modifier goes, in a bullet and in a summary sentence (N08, N01)", () => {
    expect(item("N08", /customer-facing macros/).final).toBe("Raised CSAT from 82% to 91% by rewriting 35 macros and help-centre articles.");
    expect(item("N01", /data-driven/).final).toBe("Cut cost per acquisition from Rs 640 to Rs 410 through creative testing.");
  });

  it("an unsupported opening verb becomes the source's verb, keeping the rewrite (N06)", () => {
    expect(item("N06", /^Prepared 3 years/).final).toBe("Cleaned 3 years of POS data in Pandas and Python for a pricing study.");
  });

  it("a summary claim loses its unsupported framing, not its achievement (N04, N08, N12)", () => {
    expect(item("N04", /consistent top performer/).final).toBe("Achieved 118% of the annual quota in 2025.");
    expect(item("N08", /customer-first/).final).toBe("Raised CSAT from 82% to 91%.");
    expect(item("N12", /IATF/).final).toBe("Reduced customer complaints from 14 to 4 a quarter using 8D root cause analysis.");
  });
});

describe("where trimming would say less than a revert, or break the sentence, it reverts (limits)", () => {
  it("N05: trimming 'by introducing automated barcode scanning' would lose the candidate's own method -> revert", () => {
    expect(item("N05", /automated barcode/).final).toBe("Reduced dispatch errors from 3.2% to 0.9% by introducing barcode scanning at packing.");
  });

  it("N12 / N11: an unsupported coordinated noun ('and APQP', 'and landing pages') is not deleted -> revert", () => {
    expect(item("N12", /PPAP and APQP/).outcome).toBe("reverted");
    expect(item("N11", /landing pages/).outcome).toBe("reverted");
  });

  it("truthful synonyms the role does not use are still reverted (known cost)", () => {
    expect(agg.byKind.truthful_unscoped.retained).toBe(0);
    expect(agg.byKind.truthful_unscoped.leaks).toBe(0);
  });
});

describe("summary role relevance (failed before)", () => {
  it("naming the target role is not claiming its skills: every summary names the role sought (10/12 before)", () => {
    expect(agg.summary_names_target).toBe(12);
    expect(agg.summary_fell_back).toBe(0);
  });

  it("claiming a skill-bearing title as the candidate's own is still removed", () => {
    const c = corpus.find((x) => x.id === "N11")!;
    const profile = structuredClone(c.profile);
    Object.assign(profile, usableSections(profile));
    const out = postProcessResume(
      { ...structuredClone(c.output), summary: "UI/UX Designer with 3+ years of professional experience in brand identity design." },
      profile, { now: CORPUS_NOW }
    ).resume as GeneratedResume;
    expect(out.summary).not.toMatch(/^UI\/UX Designer with/);
  });

  it.each(corpus.map((c) => [c.id, c.profile.summary] as [string, string]))(
    "%s: the candidate's own summary counts as opening with who they are",
    (_id, summary) => expect(opensWithIdentity(summary)).toBe(true)
  );
});

describe("source achievements and advice counts (failed before)", () => {
  it("every source bullet's numbers survive in the full resume, even when a fabricated bullet displaced one (11/12 before)", () => {
    expect(agg.source_achievements_preserved).toBe(12);
    const n09 = results.find((r) => r.id === "N09")!;
    expect(n09.source_achievements_preserved).toBe(true);
  });

  it("advice that says 'N of the M' with a different-length list is corrected (8/12 before)", () => {
    expect(agg.gates.advice_fidelity).toBe(12);
  });

  it("live S05 (final-live-2): '8 of the 10 curated keywords' listing 9 fails as captured and is corrected", () => {
    const ROOT = path.join(__dirname, "..", "evals", "resume-quality");
    const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    const s = read<{ scenarios: Scenario[] }>("scenarios.json").scenarios.find((x) => x.id === "S05")!;
    const profile = read<ProfileFixture>("fixtures/profiles/B-recent-grad-intern.json");
    Object.assign(profile.user_profile, usableSections(profile.user_profile));
    const jd = read<JdFixture>("fixtures/jds/google-swe2-cloud-bengaluru.json");
    const cap = read<{ final_resume: GeneratedResume }>("captured/live-final-2/S05.json").final_resume;
    const gate = (r: GeneratedResume) => evaluateResume(profile, jd, s, r, CORPUS_NOW).gates.find((g) => g.gate === "advice_fidelity")!;
    expect(gate(cap).defects.join()).toMatch(/says "8 of the 10 curated keywords" but lists 9/);
    const after = postProcessResume(structuredClone(cap), profile.user_profile, { now: CORPUS_NOW }).resume as GeneratedResume;
    expect(after.growth_note).toMatch(/9 of the 10 curated keywords/);
    expect(gate(after).pass).toBe(true);
  });
});
