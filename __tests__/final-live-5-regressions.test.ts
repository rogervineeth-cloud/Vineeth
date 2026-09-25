/**
 * Regressions from the live run of c1c3c95 (final-live-5, 2026-09-25). Each
 * test replays the captured RAW model reply through today's
 * postProcessResume; the as-captured output (previous code) is shown to differ.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume } from "@/lib/resume-generation";
import { Evidence, novelDetail, headNounOnEvidence } from "@/lib/detail-evidence";
import { usableSections } from "@/lib/profile-completeness";
import { evaluateResume, skillsIn, type ProfileFixture, type JdFixture, type Scenario, type GeneratedResume } from "../evals/resume-quality/evaluate";

const ROOT = path.join(__dirname, "..", "evals", "resume-quality");
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const PROFILES: Record<string, string> = {
  A: "A-fresher-projects.json", B: "B-recent-grad-intern.json", C: "C-experienced-backend.json",
  D: "D-career-returner.json", E: "E-multi-role-fullstack.json",
};
const JDS: Record<string, string> = {
  "GOOG-SWE2": "google-swe2-cloud-bengaluru.json", "AMZ-SDE2": "amazon-sde2-10533780.json", "AMZ-SDE": "amazon-sde-2968029.json",
};
const { scenarios } = read<{ scenarios: Scenario[] }>("scenarios.json");
const NOW = new Date("2026-09-24T12:00:00Z");
const IDS = scenarios.map((s) => s.id);

type Capture = { raw_resume: GeneratedResume; final_resume: GeneratedResume };
function load(id: string) {
  const s = scenarios.find((x) => x.id === id)!;
  const profile = read<ProfileFixture>(`fixtures/profiles/${PROFILES[s.profile]}`);
  Object.assign(profile.user_profile, usableSections(profile.user_profile));
  const jd = read<JdFixture>(`fixtures/jds/${JDS[s.jd]}`);
  const cap = read<Capture>(`captured/live-final-5/${id}.json`);
  const replayed = postProcessResume(structuredClone(cap.raw_resume), profile.user_profile, { now: NOW }).resume as GeneratedResume;
  return { s, profile, jd, cap, replayed };
}
const gate = (r: ReturnType<typeof evaluateResume>, g: string) => r.gates.find((x) => x.gate === g)!;
const tips = (r: GeneratedResume) => (r.profile_improvement_tips ?? []) as string[];

describe("S08/S09: the evidenced domain stays in the summary", () => {
  it.each(["S08", "S09"])("%s: 'in embedded systems and firmware testing' is kept (lost as captured)", (id) => {
    const { cap, replayed } = load(id);
    expect(cap.final_resume.summary).not.toMatch(/embedded/);
    expect(replayed.summary).toMatch(/^QA Engineer with 2\+ years of professional experience in embedded systems and firmware testing\. Seeking a Software (?:Engineer II role at Google Cloud|Development Engineer role)\.$/);
  });

  it("'systems' is supported only when it heads an evidenced word, at every use", () => {
    const ev = new Evidence("QA engineer testing BLE and embedded devices; firmware regression cases");
    expect(headNounOnEvidence("experience in embedded systems and firmware testing", "systems", ev)).toBe(true);
    expect(headNounOnEvidence("experience in scalable systems", "systems", ev)).toBe(false);
    expect(headNounOnEvidence("experience in distributed systems", "systems", ev)).toBe(false);
    expect(headNounOnEvidence("embedded systems and distributed systems", "systems", ev)).toBe(false);
    expect(novelDetail("QA Engineer with experience in embedded systems.", ev, { summary: true })).toEqual([]);
    expect(novelDetail("QA Engineer with experience in scalable systems.", ev, { summary: true })).toEqual(["scalable", "systems"]);
    // Bullets and projects are unchanged: the head-noun rule is summary-only.
    expect(novelDetail("Tested embedded systems.", ev)).toEqual(["systems"]);
  });

  it("an unevidenced domain is still removed from a profile-D summary", () => {
    const { profile } = load("S09");
    const r = postProcessResume(
      { tailored_role: "Software Engineer II", summary: "QA Engineer with 2+ years of professional experience in distributed systems and cloud-native testing. Seeking a Software Engineer II role at Google Cloud." },
      profile.user_profile, { now: NOW }
    ).resume as GeneratedResume;
    expect(r.summary).not.toMatch(/distributed|cloud-native/i);
    expect(r.summary).toMatch(/\bQA engineer\b/i);
  });
});

describe("S07: tailored summary and the skill-list growth tip", () => {
  it("summary keeps 'building backend systems in Java and Spring Boot' and drops only 'scalable'", () => {
    const { cap, replayed } = load("S07");
    expect(cap.final_resume.summary).toBe("Software Engineer with 3+ years of professional experience. Seeking the Software Engineer II role at Google Cloud.");
    expect(replayed.summary).toBe("Software Engineer with 3+ years of professional experience building backend systems in Java and Spring Boot. Seeking the Software Engineer II role at Google Cloud.");
  });

  it("'Deepen your System Design and Distributed Systems knowledge…' is kept (dropped as captured)", () => {
    const { cap, replayed } = load("S07");
    expect(tips(cap.final_resume)).toHaveLength(2);
    expect(tips(replayed)).toHaveLength(3);
    expect(tips(replayed)[1]).toMatch(/^Deepen your System Design and Distributed Systems knowledge through structured learning/);
  });

  it("a possessive that binds a non-skill word to the skill still presupposes it", () => {
    const { profile, replayed } = load("S07");
    const bad = [
      "Deepen your System Design contributions and knowledge of queues.",
      "Strengthen your System Design leadership and Kafka expertise.",
      "Formalise your System Design knowledge in a design doc.",
    ];
    const r = postProcessResume({ ...structuredClone(replayed), profile_improvement_tips: bad }, profile.user_profile, { now: NOW }).resume as GeneratedResume;
    expect(tips(r)).toEqual([]);
  });

  it("the evaluator agrees: the S07 tip passes, a bound skill still fails", () => {
    const { profile, jd, s, replayed } = load("S07");
    expect(gate(evaluateResume(profile, jd, s, replayed, NOW), "advice_fidelity").defects).toEqual([]);
    const bad = { ...replayed, profile_improvement_tips: ["Deepen your System Design contributions and knowledge of queues."] };
    expect(gate(evaluateResume(profile, jd, s, bad, NOW), "advice_fidelity").defects.join()).toMatch(/presupposes the candidate's System Design/);
  });
});

describe("S01/S10 ATS scores: kept visible, accepted as non-blocking on evidence", () => {
  it.each(["S01", "S10"])("%s: the model's score is untouched, every cited gap is genuinely absent, and the flag still fires", (id) => {
    const { profile, jd, s, cap, replayed } = load(id);
    expect(replayed.ats_score).toBe(cap.raw_resume.ats_score);
    const have = skillsIn(JSON.stringify(profile.user_profile));
    const missing = (replayed.missing_keywords ?? []) as string[];
    expect(missing.length).toBeGreaterThanOrEqual(4);
    for (const k of missing) expect({ k, evidenced: [...skillsIn(k)].some((x) => have.has(x)) }).toEqual({ k, evidenced: false });
    expect(gate(evaluateResume(profile, jd, s, replayed, NOW), "seniority_calibration").defects.join()).toMatch(/undersells a matching profile/);
  });
});

describe("all 11 final-live-5 captures, replayed", () => {
  it("only S07, S08 and S09 change", () => {
    const changed = IDS.filter((id) => {
      const { cap, replayed } = load(id);
      return JSON.stringify(cap.final_resume) !== JSON.stringify(replayed);
    });
    expect(changed).toEqual(["S07", "S08", "S09"]);
  });

  it.each(IDS)("%s: every gate but the ATS heuristic passes; the role is named", (id) => {
    const { profile, jd, s, replayed } = load(id);
    const ev = evaluateResume(profile, jd, s, replayed, NOW);
    for (const g of ev.gates.filter((x) => x.gate !== "seniority_calibration")) {
      expect({ id, g: g.gate, defects: g.defects }).toEqual({ id, g: g.gate, defects: [] });
    }
    expect(gate(ev, "seniority_calibration").pass).toBe(!["S01", "S10"].includes(id));
    expect(replayed.summary).toMatch(/\bSeeking\b[^.]*\brole\b/i);
  });
});
