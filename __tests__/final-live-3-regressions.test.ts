/**
 * Regressions from the final live rerun of the trimming code (final-live-3,
 * 2026-09-25). The captures hold the RAW model reply, so each test replays it
 * through today's postProcessResume and checks the output; where noted, the
 * as-captured output (produced by the previous code) fails the same check.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume, opensWithIdentity, keepsSummaryFraming, maskSoughtRole, enforceSkillEvidence } from "@/lib/resume-generation";
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

type Capture = { raw_resume: GeneratedResume; final_resume: GeneratedResume };
function load(id: string) {
  const s = scenarios.find((x) => x.id === id)!;
  const profile = read<ProfileFixture>(`fixtures/profiles/${PROFILES[s.profile]}`);
  Object.assign(profile.user_profile, usableSections(profile.user_profile));
  const jd = read<JdFixture>(`fixtures/jds/${JDS[s.jd]}`);
  const cap = read<Capture>(`captured/live-final-3/${id}.json`);
  const replayed = postProcessResume(structuredClone(cap.raw_resume), profile.user_profile, { now: NOW }).resume as GeneratedResume;
  return { s, profile, jd, cap, replayed };
}
const gate = (r: ReturnType<typeof evaluateResume>, g: string) => r.gates.find((x) => x.gate === g)!;
const IDS = scenarios.map((s) => s.id);

describe("summaries no longer collapse to a bare title (S08, S09, S10)", () => {
  it.each(["S08", "S09", "S10"])("%s: the as-captured summary fails summary_framing as a fragment", (id) => {
    const { profile, jd, s, cap } = load(id);
    expect(gate(evaluateResume(profile, jd, s, cap.final_resume, NOW), "summary_framing").defects.join()).toMatch(/summary is a fragment/);
  });

  it("replayed: the standard opening with the correct years, then the role sought", () => {
    expect(load("S08").replayed.summary).toBe("QA Engineer with 2+ years of professional experience. Seeking a Software Development Engineer role.");
    expect(load("S09").replayed.summary).toBe("QA Engineer with 2+ years of professional experience. Seeking a Software Engineer II role at Google Cloud.");
    expect(load("S10").replayed.summary).toBe("Software Engineer (Full Stack) with 5+ years of professional experience. Seeking the Software Development Engineer II role.");
  });

  it("a trim that drops the years claim or leaves a title fragment is refused", () => {
    const titles = ["QA Engineer", "B.E. Electronics and Communication"];
    const orig = "QA Engineer with 2+ years of professional experience in embedded systems and firmware testing.";
    expect(keepsSummaryFraming(orig, "QA Engineer.", titles)).toBe(false);
    expect(keepsSummaryFraming(orig, "QA Engineer in firmware testing.", titles)).toBe(false);
    expect(keepsSummaryFraming(orig, "QA Engineer with 2+ years of professional experience in firmware testing.", titles)).toBe(true);
  });
});

describe("target-role framing survives by trimming the unsupported subclause (failed before)", () => {
  it("every replayed summary names the role sought and opens with who the candidate is (1/11 named it as captured)", () => {
    const named = (id: string, r: GeneratedResume) => /\b(?:Seeking|Targeting)\b[^.]*\b(?:role|position)\b/.test(r.summary ?? "") ? id : null;
    expect(IDS.map((id) => named(id, load(id).cap.final_resume)).filter(Boolean)).toEqual(["S04"]);
    for (const id of IDS) {
      const { replayed } = load(id);
      expect({ id, named: !!named(id, replayed), identity: opensWithIdentity(replayed.summary ?? "") }).toEqual({ id, named: true, identity: true });
    }
  });

  it("S06: 'to deepen expertise in distributed systems architecture and design patterns' goes, the role stays", () => {
    expect(load("S06").replayed.summary).toMatch(/Seeking the Software Development Engineer II role\.$/);
    expect(load("S06").replayed.summary).not.toMatch(/distributed|design patterns/i);
  });

  it("naming the employer sought is not a GCP claim, but a GCP claim elsewhere in the sentence still is", () => {
    expect(maskSoughtRole("Seeking a Software Engineer II role at Google Cloud, with Python.", "")).not.toMatch(/Google Cloud/);
    const D = read<ProfileFixture>("fixtures/profiles/D-career-returner.json").user_profile;
    const r = enforceSkillEvidence({ summary: "QA engineer with 2 years testing BLE devices. Seeking a Software Engineer II role at Google Cloud, with deep GCP expertise." } as never, D);
    expect((r.resume as GeneratedResume).summary).not.toMatch(/GCP/);
  });

  it.each(IDS)("%s replayed: factual, detail, framing, advice and keyword gates pass", (id) => {
    const { profile, jd, s, replayed } = load(id);
    const ev = evaluateResume(profile, jd, s, replayed, NOW);
    for (const g of ["factual_fidelity", "detail_fidelity", "summary_framing", "advice_fidelity", "ats_keywords"]) {
      expect({ id, g, defects: gate(ev, g).defects }).toEqual({ id, g, defects: [] });
    }
  });
});

describe("advice is not over-trimmed (S07, S10, S11)", () => {
  it("S07: 'neither of which your profile currently shows' is a stated gap, not a claim", () => {
    const { cap, replayed } = load("S07");
    expect(cap.final_resume.growth_note).not.toMatch(/neither of which/);
    expect(replayed.growth_note).toMatch(/neither of which your profile currently shows/);
  });

  it("S10: 4/4 tips (2/4 as captured); the presupposing clause of tip 3 is cut, not the tip", () => {
    const { cap, replayed } = load("S10");
    expect(cap.final_resume.profile_improvement_tips).toHaveLength(2);
    expect(replayed.profile_improvement_tips).toHaveLength(4);
    expect(replayed.profile_improvement_tips).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Deepen your distributed systems knowledge by studying/),
      "Lead or participate in formal code review processes.",
    ]));
    expect((replayed.profile_improvement_tips as string[]).join()).not.toMatch(/your design pattern usage/);
  });

  it("S11: the growth-note sentence and the 'deepen your expertise' tip return; the presupposing tip stays out", () => {
    const { cap, replayed } = load("S11");
    expect(cap.final_resume.growth_note).not.toMatch(/Consider gaining Python/);
    expect(replayed.growth_note).toMatch(/Consider gaining Python proficiency and deepening your distributed systems knowledge/);
    expect(replayed.profile_improvement_tips).toEqual([
      expect.stringMatching(/^Gain hands-on experience with Python or C\+\+/),
      expect.stringMatching(/^Deepen your system design expertise by studying/),
    ]);
  });

  it("claims are still caught: formalising or presupposing a skill the profile lacks", () => {
    const { profile, replayed } = load("S11");
    const r = postProcessResume(
      { ...structuredClone(replayed), growth_note: "Recommend formalising your system design contributions.", profile_improvement_tips: ["Formalise your System Design knowledge in a design doc."] },
      profile.user_profile, { now: NOW }
    ).resume as GeneratedResume;
    expect(r.growth_note).not.toMatch(/system design contributions/);
    expect(r.profile_improvement_tips).toEqual([]);
  });
});
