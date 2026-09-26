/**
 * Proper nouns the candidate supplied — institution, degree, education years
 * and employer — are shown with the candidate's own spelling. Live eval
 * final-live-6 S04: the model wrote "Declan College of Engineering" for the
 * profile's "Deccan College of Engineering" and nothing in the runtime caught
 * it (only placeholders were dropped).
 */
import * as fs from "fs";
import * as path from "path";
import { sanitiseGeneratedResume, resolveProfileName, type SanitiseProfile, type ResumeShape } from "@/lib/sanitise-resume";
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
  const cap = read<{ raw_resume: GeneratedResume; final_resume: GeneratedResume }>(`captured/live-final-6/${id}.json`);
  const out = postProcessResume(structuredClone(cap.raw_resume), profile.user_profile, { now: NOW });
  return { s, profile, jd, cap, replayed: out.resume as GeneratedResume, warnings: out.warnings };
}
const gate = (r: ReturnType<typeof evaluateResume>, g: string) => r.gates.find((x) => x.gate === g)!;

const PROFILE: SanitiseProfile = {
  experience: [
    { company: "Acme Logistics Pvt Ltd", role: "Backend Engineer", duration: "Jun 2022 - Present", bullets: ["Cut infra cost by 38%."] },
    { company: "Acme Logistics Pvt Ltd", role: "Associate Engineer", duration: "Jun 2021 - May 2022", bullets: ["Wrote 40 tests."] },
    { company: "Brightline Retail", role: "QA Analyst", duration: "Jan 2020 - May 2021", bullets: ["Ran load tests."] },
  ],
  education: [
    { institution: "Deccan College of Engineering", degree: "B.Tech Information Technology", year: "2016 - 2020" },
    { institution: "IIT Madras", degree: "M.Tech CSE", year: "2020 - 2022" },
  ],
};
const sanitise = (r: ResumeShape) => sanitiseGeneratedResume(structuredClone(r), PROFILE);

describe("S04 (final-live-6): a misspelt institution is restored", () => {
  it("as captured the final resume said 'Declan' and the evaluator failed it", () => {
    const { profile, jd, s, cap } = load("S04");
    expect(cap.final_resume.education?.[0].institution).toBe("Declan College of Engineering");
    expect(gate(evaluateResume(profile, jd, s, cap.final_resume, NOW), "factual_fidelity").defects).toEqual(['unknown institution "Declan College of Engineering"']);
  });

  it("replayed: the candidate's 'Deccan College of Engineering', and factual_fidelity passes", () => {
    const { profile, jd, s, replayed, warnings } = load("S04");
    expect(replayed.education?.map((e) => e.institution)).toEqual(["Deccan College of Engineering"]);
    expect(warnings).toContain("restored_institution:Declan College of Engineering->Deccan College of Engineering");
    expect(gate(evaluateResume(profile, jd, s, replayed, NOW), "factual_fidelity").defects).toEqual([]);
  });

  it("all 11 final-live-6 captures replayed: only S04 changes; every gate but the ATS heuristic passes", () => {
    const changed: string[] = [];
    for (const id of IDS) {
      const { profile, jd, s, cap, replayed } = load(id);
      if (JSON.stringify(cap.final_resume) !== JSON.stringify(replayed)) changed.push(id);
      const ev = evaluateResume(profile, jd, s, replayed, NOW);
      for (const g of ev.gates.filter((x) => x.gate !== "seniority_calibration")) {
        expect({ id, g: g.gate, defects: g.defects }).toEqual({ id, g: g.gate, defects: [] });
      }
    }
    expect(changed).toEqual(["S04"]);
  });
});

describe("resolveProfileName", () => {
  const names = PROFILE.education!.map((e) => e.institution);
  it("restores a one-letter mutation and keeps an exact match", () => {
    expect(resolveProfileName("Declan College of Engineering", names)).toBe("Deccan College of Engineering");
    expect(resolveProfileName("deccan college of engineering", names)).toBe("Deccan College of Engineering");
  });
  it("restores a shortened employer only from its distinctive words", () => {
    expect(resolveProfileName("Acme Logistics", ["Acme Logistics Pvt Ltd", "Brightline Retail"])).toBe("Acme Logistics Pvt Ltd");
    expect(resolveProfileName("IIT", ["IIT Madras"])).toBeNull();
  });
  it("refuses an unrelated or ambiguous name", () => {
    expect(resolveProfileName("Globex Corporation", ["Acme Logistics Pvt Ltd"])).toBeNull();
    expect(resolveProfileName("Acme Logistic", ["Acme Logistics", "Acme Logistica"])).toBeNull();
  });
});

describe("education: the candidate's institution, degree and years", () => {
  it("drops an institution that matches no profile entry", () => {
    const { resume, warnings } = sanitise({ education: [{ institution: "Stanford University", degree: "MS Computer Science", year: "2023" }] });
    expect(resume.education).toBeUndefined();
    expect(warnings).toContain("dropped_fabricated_institution:Stanford University");
  });

  it("restores the institution from a matching degree and years (expanded or renamed name)", () => {
    const { resume, warnings } = sanitise({ education: [{ institution: "Indian Institute of Technology, Madras", degree: "M.Tech CSE", year: "2020 - 2022" }] });
    expect(resume.education).toEqual([{ institution: "IIT Madras", degree: "M.Tech CSE", year: "2020 - 2022" }]);
    expect(warnings).toContain("restored_institution:Indian Institute of Technology, Madras->IIT Madras");
  });

  it("an inflated degree or shifted years on a matched institution are restored", () => {
    const { resume } = sanitise({ education: [{ institution: "Deccan College of Engineering", degree: "M.Tech Information Technology", year: "2017 - 2021" }] });
    expect(resume.education).toEqual([{ institution: "Deccan College of Engineering", degree: "B.Tech Information Technology", year: "2016 - 2020" }]);
  });

  it("a verbatim entry is untouched; placeholders are still dropped; no profile education means no check", () => {
    const ok = { institution: "IIT Madras", degree: "M.Tech CSE", year: "2020 - 2022" };
    expect(sanitise({ education: [ok] }).resume.education).toEqual([ok]);
    expect(sanitise({ education: [{ institution: "Institution Name", degree: "B.Tech", year: "2020" }] }).warnings).toContain("dropped_placeholder_institution:Institution Name");
    expect(sanitiseGeneratedResume({ education: [ok] }, { experience: [] }).resume.education).toEqual([ok]);
  });
});

describe("employer: the candidate's spelling (analogous to S04)", () => {
  const exp = (company: string, role = "Backend Engineer", duration = "Jun 2022 - Present") => ({ company, role, duration, bullets: ["Cut infra cost by 38%."] });

  it("a misspelt or shortened employer is restored, not dropped with its truthful bullets", () => {
    for (const c of ["Acme Logisitcs Pvt Ltd", "Acme Logistics"]) {
      const { resume, warnings } = sanitise({ experience: [exp(c)] });
      expect(resume.experience?.map((e) => e.company)).toEqual(["Acme Logistics Pvt Ltd"]);
      expect(resume.experience?.[0].bullets).toEqual(["Cut infra cost by 38%."]);
      expect(warnings).toContain(`restored_company_name:${c}->Acme Logistics Pvt Ltd`);
    }
  });

  it("both roles at a multi-role employer are restored", () => {
    const { resume } = sanitise({ experience: [exp("Acme Logistcs Pvt Ltd"), exp("Acme Logistcs Pvt Ltd", "Associate Engineer", "Jun 2021 - May 2022")] });
    expect(resume.experience?.map((e) => `${e.company}|${e.role}`)).toEqual(["Acme Logistics Pvt Ltd|Backend Engineer", "Acme Logistics Pvt Ltd|Associate Engineer"]);
  });

  it("a renamed employer with exactly one profile role's title and dates is restored", () => {
    const { resume } = sanitise({ experience: [exp("Brightline Retail Tech Solutions", "QA Analyst", "Jan 2020 - May 2021")] });
    expect(resume.experience?.map((e) => e.company)).toEqual(["Brightline Retail"]);
  });

  it("a fabricated employer is still dropped", () => {
    const { resume, warnings } = sanitise({ experience: [exp("Globex Corporation", "Staff Engineer", "2019 - 2020")] });
    expect(resume.experience).toBeUndefined();
    expect(warnings).toContain("dropped_fabricated_company:Globex Corporation");
  });
});
