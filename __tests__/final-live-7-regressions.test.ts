/**
 * Regression from the final QA run of b7ab77e (final-live-7, 2026-09-25):
 * an S07 tip told a backend engineer with no distributed-systems evidence
 * "your microservices and distributed systems work translates well". Advice
 * may tell a candidate to build experience; it may not attribute a skill or
 * domain they lack — whatever the verb — to work they have done.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume } from "@/lib/resume-generation";
import { usableSections } from "@/lib/profile-completeness";
import { evaluateResume, type ProfileFixture, type JdFixture, type Scenario, type GeneratedResume } from "../evals/resume-quality/evaluate";

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

function load(id: string) {
  const s = scenarios.find((x) => x.id === id)!;
  const profile = read<ProfileFixture>(`fixtures/profiles/${PROFILES[s.profile]}`);
  Object.assign(profile.user_profile, usableSections(profile.user_profile));
  const jd = read<JdFixture>(`fixtures/jds/${JDS[s.jd]}`);
  const cap = read<{ raw_resume: GeneratedResume; final_resume: GeneratedResume }>(`captured/live-final-7/${id}.json`);
  const out = postProcessResume(structuredClone(cap.raw_resume), profile.user_profile, { now: NOW });
  return { s, profile, jd, cap, replayed: out.resume as GeneratedResume, warnings: out.warnings };
}
const gate = (r: ReturnType<typeof evaluateResume>, g: string) => r.gates.find((x) => x.gate === g)!;
const tips = (r: GeneratedResume) => (r.profile_improvement_tips ?? []) as string[];

const LIVE_TIP =
  "Gain hands-on experience with Google Cloud Platform (GCP) services such as Compute Engine, Cloud Storage, or Pub/Sub; your microservices and distributed systems work translates well, but GCP-specific projects will boost your profile.";

/** Profile C (S07) with the given advice; missing keywords as the live S07 reply listed them. */
function advise(adviceTips: string[], growth_note?: string, missing_keywords?: string[]) {
  const { profile, jd, s, replayed } = load("S07");
  const input = { ...structuredClone(replayed), profile_improvement_tips: adviceTips, growth_note: growth_note ?? replayed.growth_note, ...(missing_keywords ? { missing_keywords } : {}) };
  const out = postProcessResume(input, profile.user_profile, { now: NOW }).resume as GeneratedResume;
  return { out, input, evalOf: (r: GeneratedResume) => gate(evaluateResume(profile, jd, s, r, NOW), "advice_fidelity").defects };
}

describe("S07 (final-live-7): 'your microservices and distributed systems work translates well'", () => {
  it("the exact live tip was kept as captured, and the evaluator now flags it", () => {
    const { profile, jd, s, cap } = load("S07");
    expect(tips(cap.final_resume)).toContain(LIVE_TIP);
    expect(gate(evaluateResume(profile, jd, s, cap.final_resume, NOW), "advice_fidelity").defects.join())
      .toMatch(/attributes Distributed Systems to the candidate: "your microservices and distributed systems/);
  });

  it("replayed: the tip keeps its clean instruction and loses the attribution", () => {
    const { profile, jd, s, replayed, warnings } = load("S07");
    expect(tips(replayed)).toContain("Gain hands-on experience with Google Cloud Platform (GCP) services such as Compute Engine, Cloud Storage, or Pub/Sub.");
    expect(tips(replayed).join(" ")).not.toMatch(/distributed systems work/i);
    expect(warnings).toContain("trimmed_tip:attributes_unevidenced:Distributed Systems");
    expect(gate(evaluateResume(profile, jd, s, replayed, NOW), "advice_fidelity").defects).toEqual([]);
  });

  it("all 11 final-live-7 captures replayed: only S07 changes; every gate but the ATS heuristic passes", () => {
    const changed: string[] = [];
    for (const id of IDS) {
      const { profile, jd, s, cap, replayed } = load(id);
      if (JSON.stringify(cap.final_resume) !== JSON.stringify(replayed)) changed.push(id);
      for (const g of evaluateResume(profile, jd, s, replayed, NOW).gates.filter((x) => x.gate !== "seniority_calibration")) {
        expect({ id, g: g.gate, defects: g.defects }).toEqual({ id, g: g.gate, defects: [] });
      }
    }
    expect(changed).toEqual(["S07"]);
  });
});

describe("advice may not attribute a missing skill or domain to the candidate's experience", () => {
  it.each([
    "Your microservices and distributed systems work translates well to Google Cloud.",
    "Leverage your distributed systems experience in system design interviews.",
    "Your System Design background will carry over to Google Cloud.",
    "Point interviewers to your Python and GCP projects.",
  ])("rejected, whatever the verb: %s", (tip) => {
    const { out, input, evalOf } = advise([tip]);
    expect(tips(out)).toEqual([]);
    expect(evalOf(input as GeneratedResume).join()).toMatch(/attributes .* to the candidate/);
  });

  it("a domain only the missing-keyword list names is caught too", () => {
    const missing = ["Scalable transactional backends"];
    const { out, input, evalOf } = advise(["Your scalable transactional backends work is a strong fit."], undefined, missing);
    expect(tips(out)).toEqual([]);
    expect(evalOf(input as GeneratedResume).join()).toMatch(/attributes Scalable transactional backends/);
  });

  it("a growth-note sentence that attributes it is dropped; the rest of the note stays", () => {
    const { out } = advise([], "Your microservices and distributed systems work translates well to Google Cloud. Gaining GCP experience will strengthen your fit.");
    expect(out.growth_note).toBe("Gaining GCP experience will strengthen your fit.");
  });

  it.each([
    "Build experience with distributed systems through a side project such as a replicated key-value store.",
    "Gain your first distributed systems experience through an open-source contribution.",
    "Deepen your distributed systems expertise through structured study.",
    "Highlight adjacent work such as your Redis caching and the microservices split in interviews.",
    "Highlight your microservices work as adjacent experience for distributed systems roles.",
    "Your Java expertise is strong; learning Python would widen your options.",
    "Your profile does not yet show distributed systems work, so build a small replicated service.",
  ])("kept (growth, adjacent evidenced work, or a stated gap): %s", (tip) => {
    const { out, input, evalOf } = advise([tip]);
    expect(tips(out)).toEqual([tip]);
    expect(evalOf(input as GeneratedResume).filter((d) => /attributes/.test(d))).toEqual([]);
  });
});
