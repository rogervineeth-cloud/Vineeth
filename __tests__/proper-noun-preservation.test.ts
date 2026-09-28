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

  it("an inflated degree or shifted years are NOT rewritten onto a matched institution: the entry is dropped", () => {
    // Previously restored from the institution-name match. The degree and year
    // are what identify the entry; when they changed, nothing is guessed.
    const { resume, warnings } = sanitise({ education: [{ institution: "Deccan College of Engineering", degree: "M.Tech Information Technology", year: "2017 - 2021" }] });
    expect(resume.education).toBeUndefined();
    expect(warnings).toContain("dropped_education_degree_or_year_mismatch:Deccan College of Engineering");
  });

  it("a verbatim entry is untouched; placeholders are still dropped; with no profile education, model education is dropped", () => {
    const ok = { institution: "IIT Madras", degree: "M.Tech CSE", year: "2020 - 2022" };
    expect(sanitise({ education: [ok] }).resume.education).toEqual([ok]);
    expect(sanitise({ education: [{ institution: "Institution Name", degree: "B.Tech", year: "2020" }] }).warnings).toContain("dropped_placeholder_institution:Institution Name");
    const none = sanitiseGeneratedResume({ education: [ok] }, { experience: [] });
    expect(none.resume.education).toBeUndefined();
    expect(none.warnings).toContain("dropped_fabricated_institution:IIT Madras");
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

// PR #38 release blocker: the model altered an institution name ("Deccan" ->
// "Declan") and the runtime did not correct it. Rule: the institution is
// preserved/restored from the profile ONLY when the entry's degree and year
// match a profile entry; otherwise the model's entry is dropped.
describe("factual fidelity guard: degree + year identify the education entry", () => {
  const DECCAN = { institution: "Deccan College of Engineering", degree: "B.Tech Information Technology", year: "2016 - 2020" };
  const edu = (over: Partial<typeof DECCAN>) => sanitise({ education: [{ ...DECCAN, ...over }] });

  it("Declan with the candidate's degree and year → restored to Deccan, verbatim", () => {
    const { resume, warnings } = edu({ institution: "Declan College of Engineering" });
    expect(resume.education).toEqual([DECCAN]);
    expect(warnings).toContain("restored_institution:Declan College of Engineering->Deccan College of Engineering");
  });

  it("any altered institution name is replaced when degree and year match (not only near misses)", () => {
    expect(edu({ institution: "Deccan Engg. College, Hyderabad" }).resume.education).toEqual([DECCAN]);
  });

  it.each([
    ["degree changed", { institution: "Declan College of Engineering", degree: "B.E. Information Technology" }],
    ["degree inflated", { institution: "Declan College of Engineering", degree: "M.Tech Information Technology" }],
    ["year shifted", { institution: "Declan College of Engineering", year: "2017 - 2021" }],
    ["year missing", { institution: "Declan College of Engineering", year: "" }],
    ["exact institution, year shifted", { year: "2016 - 2021" }],
  ])("%s → the entry is dropped, not restored and not invented", (_label, over) => {
    const { resume, warnings } = edu(over);
    expect(resume.education).toBeUndefined();
    expect(JSON.stringify(resume)).not.toMatch(/Declan|Deccan/);
    expect(warnings.some((w) => w.startsWith("dropped_education_degree_or_year_mismatch:"))).toBe(true);
  });

  it("degree punctuation/spacing and year formatting differences still match, and show the candidate's text", () => {
    const { resume } = edu({ institution: "Declan College of Engineering", degree: "B. Tech  Information-Technology", year: "2016–2020" });
    expect(resume.education).toEqual([DECCAN]);
  });

  it("an unknown institution with an unknown degree/year is dropped as fabricated", () => {
    const { resume, warnings } = sanitise({ education: [{ institution: "Stanford University", degree: "MS CS", year: "2023" }] });
    expect(resume.education).toBeUndefined();
    expect(warnings).toContain("dropped_fabricated_institution:Stanford University");
  });

  it("two profile entries with the same degree and year: a near-miss name picks one; an unrelated name drops the entry", () => {
    const twin: SanitiseProfile = { experience: [], education: [
      { institution: "Deccan College of Engineering", degree: "Diploma", year: "2020" },
      { institution: "Osmania University", degree: "Diploma", year: "2020" },
    ] };
    expect(sanitiseGeneratedResume({ education: [{ institution: "Osmaina University", degree: "Diploma", year: "2020" }] }, twin).resume.education)
      .toEqual([{ institution: "Osmania University", degree: "Diploma", year: "2020" }]);
    expect(sanitiseGeneratedResume({ education: [{ institution: "JNTU", degree: "Diploma", year: "2020" }] }, twin).resume.education).toBeUndefined();
  });

  it("only the bad entry is dropped; the other education stays; an emptied section leaves section_order", () => {
    const { resume } = sanitise({
      section_order: ["summary", "education", "skills"],
      education: [{ ...DECCAN, institution: "Declan College of Engineering" }, { institution: "IIT Madras", degree: "M.Tech CSE", year: "2021 - 2023" }],
    });
    expect(resume.education).toEqual([DECCAN]);
    const gone = sanitise({ section_order: ["summary", "education", "skills"], education: [{ ...DECCAN, year: "2015 - 2019" }] }).resume;
    expect(gone.education).toBeUndefined();
    expect(gone.section_order).toEqual(["summary", "skills"]);
  });

  it("end to end through postProcessResume (the route's path): no 'Declan' reaches the saved resume", () => {
    const profile = {
      full_name: "Aarav Menon", email: "aarav@example.com",
      education: [{ ...DECCAN, location: "Hyderabad" }],
      experience: [], projects: [{ name: "Ledger", description: "Built a ledger app.", tech: ["Python"] }], skills: ["Python"],
    };
    const raw = { summary: "Graduate.", ats_score: 60, tailored_role: "Data Analyst", matched_keywords: [], missing_keywords: [],
      section_order: ["summary", "education", "projects", "skills"], skills: ["Python"],
      projects: [{ name: "Ledger", description: "Built a ledger app.", tech: ["Python"] }],
      education: [{ institution: "Declan College of Engineering", degree: "B.Tech Information Technology", year: "2016 - 2020", location: "Hyderabad" }] };
    const out = postProcessResume(raw, profile, { now: NOW });
    expect(JSON.stringify(out.resume)).not.toMatch(/Declan/);
    expect((out.resume as GeneratedResume).education?.[0]).toMatchObject(DECCAN);
  });
});
