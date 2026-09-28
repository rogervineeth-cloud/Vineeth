/**
 * Detail, experience, summary-framing and advice evidence — from the manual
 * audit of the final live run (evals/resume-quality/captured/live-final).
 *
 * That run scored factual_fidelity 11/11, yet the resumes still invented
 * execution detail ("using Spring Boot batch jobs"), understated experience
 * ("1+ year" for 3.2 years), opened summaries with "Proficient in ..." and
 * credited candidates in the advice with skills they do not have. The
 * evaluator did not score any of that. These tests pin both halves:
 *
 *   1. the evaluator now FAILS the real captured output on each dimension;
 *   2. today's post-processing, re-run over the same captured output (and the
 *      two earlier live captures, which it was not tuned on), passes them —
 *      without losing a truthful skill, bullet or keyword.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume, buildGenerationPayload, SYSTEM_PROMPT, enforceAdviceEvidence, enforceDetailEvidence } from "@/lib/resume-generation";
import { computeFacts, yearsProblems } from "@/lib/profile-facts";
import { Evidence, novelDetail } from "@/lib/detail-evidence";
import { usableSections } from "@/lib/profile-completeness";
import {
  evaluateResume,
  type ProfileFixture,
  type JdFixture,
  type Scenario,
  type GeneratedResume,
} from "../evals/resume-quality/evaluate";

const ROOT = path.join(__dirname, "..", "evals", "resume-quality");
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const PROFILE_FILES: Record<string, string> = {
  A: "A-fresher-projects.json", B: "B-recent-grad-intern.json", C: "C-experienced-backend.json",
  D: "D-career-returner.json", E: "E-multi-role-fullstack.json",
};
const JD_FILES: Record<string, string> = {
  "GOOG-SWE2": "google-swe2-cloud-bengaluru.json", "AMZ-SDE2": "amazon-sde2-10533780.json", "AMZ-SDE": "amazon-sde-2968029.json",
};
const { scenarios } = read<{ scenarios: Scenario[] }>("scenarios.json");
const IDS = scenarios.map((s) => s.id);
const NOW = new Date("2026-09-24T12:00:00Z");

function profileOf(key: string) {
  const p = structuredClone(read<ProfileFixture>(`fixtures/profiles/${PROFILE_FILES[key]}`));
  Object.assign(p.user_profile, usableSections(p.user_profile));
  return p;
}

function load(id: string, label = "live-final") {
  const s = scenarios.find((x) => x.id === id)!;
  const profile = profileOf(s.profile);
  const jd = read<JdFixture>(`fixtures/jds/${JD_FILES[s.jd]}`);
  const before = read<{ final_resume: GeneratedResume }>(`captured/${label}/${id}.json`).final_resume;
  const post = postProcessResume(structuredClone(before), profile.user_profile, { now: NOW });
  return { s, profile, jd, before, after: post.resume as GeneratedResume, warnings: post.warnings };
}

const gate = (ev: ReturnType<typeof evaluateResume>, g: string) => ev.gates.find((x) => x.gate === g)!;

// ── 1. The evaluator fails the real captured output ────────────────────────

describe("the evaluator scores what the manual audit found (live-final, as captured)", () => {
  const evBefore = (id: string) => {
    const { profile, jd, s, before } = load(id);
    return evaluateResume(profile, jd, s, before, NOW);
  };

  it("S06 and S07: invented batch jobs / batch processing fail detail_fidelity", () => {
    for (const id of ["S06", "S07"]) {
      const g = gate(evBefore(id), "detail_fidelity");
      expect(g.pass).toBe(false);
      expect(g.defects.join("\n")).toMatch(/batch/);
    }
    expect(gate(evBefore("S06"), "detail_fidelity").defects.join("\n")).toMatch(/query/);
  });

  it("S07: '1+ year' for 3.2 years fails seniority_calibration as understated", () => {
    expect(gate(evBefore("S07"), "seniority_calibration").defects.join()).toMatch(/understates experience: "1\+ year" vs 3.2/);
  });

  it("S10: '3 years' for 5.3 (4.3 in the current job) fails, in the summary and the advice", () => {
    const ev = evBefore("S10");
    expect(gate(ev, "seniority_calibration").defects.join()).toMatch(/understates experience: "3 years" vs 5.3/);
    expect(gate(ev, "advice_fidelity").defects.join()).toMatch(/understates experience: "3 years"/);
  });

  it("S02 and S09: summaries opening 'Proficient in ...' fail summary_framing", () => {
    for (const id of ["S02", "S09"]) expect(gate(evBefore(id), "summary_framing").pass).toBe(false);
  });

  it("S10 and S11: advice crediting unevidenced distributed systems / code review fails advice_fidelity", () => {
    const s10 = gate(evBefore("S10"), "advice_fidelity").defects.join("\n");
    expect(s10).toMatch(/credits the candidate with .*Distributed Systems/);
    const s11 = gate(evBefore("S11"), "advice_fidelity").defects.join("\n");
    expect(s11).toMatch(/credits the candidate with .*Distributed Systems/);
    expect(s11).toMatch(/tells the candidate to put Code Review/);
  });

  it("no scenario passes every gate any more (the false 11/11)", () => {
    const newGates = ["detail_fidelity", "summary_framing", "advice_fidelity", "seniority_calibration"];
    const failingAny = IDS.filter((id) => newGates.some((g) => !gate(evBefore(id), g).pass));
    expect(failingAny).toEqual(IDS);
  });
});

// ── 2. Post-processing closes them without losing truthful content ────────

describe.each(["live-final", "live-after", "live-before"])("post-processing %s", (label) => {
  it.each(IDS)("%s: detail, framing and advice pass; no years defect; fidelity holds", (id) => {
    const { profile, jd, s, after } = load(id, label);
    const ev = evaluateResume(profile, jd, s, after, NOW);
    for (const g of ["factual_fidelity", "detail_fidelity", "summary_framing", "advice_fidelity"]) {
      expect({ id, g, defects: gate(ev, g).defects }).toEqual({ id, g, defects: [] });
    }
    expect(gate(ev, "seniority_calibration").defects.join()).not.toMatch(/states experience/);
  });

  it.each(IDS)("%s: no skill, bullet, project or keyword recall is lost", (id) => {
    const { profile, jd, s, before, after } = load(id, label);
    const pre = postProcessResume(structuredClone(before), profile.user_profile, { now: NOW });
    // Skills: the detail/summary/advice stages never touch the skills list.
    expect(after.skills).toEqual((pre.resume as GeneratedResume).skills);
    // Bullets are reverted to the candidate's own, never dropped for detail.
    for (const e of after.experience ?? []) {
      const src = profile.user_profile.experience!.find((x) => x.company === e.company && x.role === e.role)!;
      for (const b of e.bullets ?? []) expect(novelDetail(b, new Evidence(src.role, src.company, ...src.bullets))).toEqual([]);
    }
    const bulletCount = (r: GeneratedResume) => (r.experience ?? []).reduce((n, e) => n + (e.bullets ?? []).length, 0);
    const beforeSkillOnly = enforceDetailEvidence(structuredClone(before) as never, profile.user_profile);
    expect(bulletCount(after)).toBe(bulletCount(beforeSkillOnly.resume as GeneratedResume));
    expect((after.projects ?? []).every((p) => (p.description ?? "").trim().length > 0)).toBe(true);
    expect(evaluateResume(profile, jd, s, after, NOW).metrics.keyword_recall).toBeGreaterThanOrEqual(
      evaluateResume(profile, jd, s, before, NOW).metrics.keyword_recall
    );
  });
});

describe("specific live-final repairs", () => {
  it("S06: the reconciliation bullet is the candidate's own again", () => {
    const { after } = load("S06");
    const bullets = after.experience!.flatMap((e) => e.bullets ?? []);
    expect(bullets).toContain("Automated nightly reconciliation reports, saving the operations team 6 hours a week.");
    expect(bullets.join(" ")).not.toMatch(/batch|query patterns|resilience/i);
  });

  it("S07: the summary no longer says 1+ year and opens with who the candidate is", () => {
    const { after } = load("S07");
    expect(after.summary).not.toMatch(/1\+ year/);
    expect(after.summary).toMatch(/^Backend engineer with 3 years/);
  });

  it("S02 and S09: the summary opens with the candidate's identity", () => {
    expect(load("S02").after.summary).toMatch(/^Computer Science graduate/);
    expect(load("S09").after.summary).toMatch(/^QA engineer with 2 years/);
  });

  it("S10: the growth note no longer says '3 years' or credits distributed systems", () => {
    const { after } = load("S10");
    expect(after.growth_note).not.toMatch(/3 years|demonstrates distributed systems/);
    expect(after.growth_note).toMatch(/requires 2\+ years of design\/architecture/);
  });

  it("S11: the overclaiming note is replaced from missing_keywords and the resume-edit tip is gone", () => {
    const { after } = load("S11");
    expect(after.growth_note).not.toMatch(/distributed systems fundamentals/);
    expect(after.growth_note).toMatch(/Python, C\+\+ and System Design, which your profile does not show yet/);
    expect((after.profile_improvement_tips as string[]).join()).not.toMatch(/Highlight code review leadership/);
    expect(after.profile_improvement_tips).toEqual([expect.stringMatching(/^Learn Python or C\+\+/)]);
  });
});

// ── 3. Units: facts, years, detail, advice ────────────────────────────────

describe("candidate facts are computed from durations", () => {
  it.each(Object.keys(PROFILE_FILES))("%s: matches the fixture's professional_years as of facts_as_of", (key) => {
    const p = profileOf(key);
    expect(computeFacts(p.user_profile, new Date(`${p.facts_as_of}T12:00:00Z`)).professional_years).toBe(p.facts.professional_years);
  });

  it("identity sentences: title and floor(years), or degree for a graduate", () => {
    expect(computeFacts(profileOf("C").user_profile, NOW).identity).toBe("Software Engineer with 3+ years of professional experience.");
    expect(computeFacts(profileOf("E").user_profile, NOW).identity).toBe("Software Engineer (Full Stack) with 5+ years of professional experience.");
    expect(computeFacts(profileOf("A").user_profile, NOW).identity).toBe("B.Tech Computer Science and Engineering graduate (2025).");
    expect(computeFacts(profileOf("B").user_profile, NOW).identity).toBe("B.Tech Information Technology graduate (2023) with 6 months of internship experience.");
  });

  it("internships are not professional years", () => {
    const f = computeFacts(profileOf("B").user_profile, NOW);
    expect(f.professional_months).toBe(0);
    expect(f.internship_months).toBe(6);
  });

  it("the payload carries the facts and the prompt requires them", () => {
    const p = profileOf("C").user_profile;
    const payload = buildGenerationPayload({ jd_text: "Backend role", jd_keywords: [], user_profile: p, now: NOW });
    expect(payload.CANDIDATE_FACTS).toMatchObject({ professional_years: 3.2, current_title: "Software Engineer", summary_opening: "Software Engineer with 3+ years of professional experience." });
    expect(SYSTEM_PROMPT).toMatch(/CANDIDATE_FACTS/);
    expect(SYSTEM_PROMPT).toMatch(/J\. REPHRASE, DON'T ELABORATE/);
    expect(SYSTEM_PROMPT).toMatch(/K\. ADVICE IS EVIDENCE-ONLY TOO/);
    expect(SYSTEM_PROMPT).not.toMatch(/Top 2 soft skills woven into summary prose/);
  });
});

describe("years claims", () => {
  const C = computeFacts(profileOf("C").user_profile, NOW);
  const E = computeFacts(profileOf("E").user_profile, NOW);
  it("accepts truthful claims", () => {
    expect(yearsProblems("Backend engineer with 3 years building microservices.", C)).toEqual([]);
    expect(yearsProblems("Engineer with 3+ years of professional experience.", C)).toEqual([]);
    expect(yearsProblems("Engineer with 4+ years of full-stack development and 1 year of QA.", E)).toEqual([]);
    expect(yearsProblems("Engineer with 5+ years of professional experience.", E)).toEqual([]);
  });
  it("rejects understated and overstated claims", () => {
    expect(yearsProblems("Engineer with 1+ year of professional experience.", C)).toEqual([{ claim: "1+ year", kind: "understated" }]);
    expect(yearsProblems("Engineer with 3 years of full-stack development experience.", E)).toEqual([{ claim: "3 years", kind: "understated" }]);
    expect(yearsProblems("Engineer with 4 years of experience.", C)).toEqual([{ claim: "4 years", kind: "overstated" }]);
    // One employer's tenure cannot stand in for a whole-career claim.
    expect(yearsProblems("Engineer with 1 year of professional experience.", E)).toEqual([{ claim: "1 year", kind: "understated" }]);
  });
});

describe("detail evidence is general, not a phrase list", () => {
  const C = profileOf("C").user_profile;
  const role = C.experience![0];
  const ev = new Evidence(role.role, role.company, ...role.bullets);
  it("pure rephrasing passes", () => {
    expect(novelDetail("Cut p95 latency of the settlement API from 800 ms to 350 ms by adding Redis caching.", ev)).toEqual([]);
    expect(novelDetail("Split the monolithic payouts module into 4 Spring Boot microservices over REST.", ev)).toEqual([]);
  });
  it("any added mechanism, component or outcome is caught", () => {
    expect(novelDetail("Reduced p95 latency by adding Redis caching and connection pooling.", ev)).toEqual(["connection", "pooling"]);
    expect(novelDetail("Split the payouts module into 4 microservices, improving uptime.", ev)).toEqual(["improving", "uptime"]);
    expect(novelDetail("Architected 4 Spring Boot microservices.", ev)).toEqual(["architected"]);
  });
  it("a reverted bullet keeps its achievement", () => {
    const r = enforceDetailEvidence({ experience: [{ ...role, bullets: ["Reduced p95 latency from 800 ms to 350 ms via Redis caching and query tuning."] }] } as never, C);
    expect((r.resume as GeneratedResume).experience![0].bullets).toEqual([role.bullets[0]]);
  });
});

describe("advice evidence", () => {
  const E = profileOf("E").user_profile;
  const facts = computeFacts(E, NOW);
  const run = (growth_note: string | null, tips: string[] = []) =>
    enforceAdviceEvidence({ growth_note, profile_improvement_tips: tips, missing_keywords: ["Python"] } as never, E, facts).resume as GeneratedResume;

  it("keeps acquisition advice, stated gaps and JD requirements", () => {
    const tips = [
      "Gain hands-on experience with distributed systems concepts through a side project.",
      "Study system design and document a design for a service you have built.",
    ];
    const note = "You have strong Kafka and Kubernetes experience, but the role requires 2+ years of distributed systems design you have not yet demonstrated.";
    const out = run(note, tips);
    expect(out.growth_note).toBe(note);
    expect(out.profile_improvement_tips).toEqual(tips);
  });

  it("drops credit for an unevidenced skill, in any wording", () => {
    for (const note of [
      "Strong match on distributed systems fundamentals.",
      "Your work shows deep distributed systems expertise.",
      "You bring proven system design leadership.",
    ]) expect(run(note).growth_note).not.toBe(note);
  });

  it("drops a tip that puts an unevidenced skill on the resume, keeps one for an evidenced skill", () => {
    const out = run(null, ["Add a bullet on your GraphQL work to the resume.", "Mention the Kafka event volume in your summary."]);
    expect(out.profile_improvement_tips).toEqual(["Mention the Kafka event volume in your summary."]);
  });

  it("drops a wrong years statement about the candidate", () => {
    expect(run("You have 2 years of professional experience.").growth_note).not.toMatch(/2 years/);
  });
});
