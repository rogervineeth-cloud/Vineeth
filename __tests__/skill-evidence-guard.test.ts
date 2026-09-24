/**
 * Skill-evidence guard (lib/resume-generation.ts#enforceSkillEvidence) and the
 * prompt rules H/I — from the live resume-quality run, 2026-09-24.
 *
 * The fixtures are the REAL model outputs captured from the preview runner
 * (evals/resume-quality/captured/live-before), checksum-verified. In 11/11
 * scenarios the model claimed skills the profile never evidences. Each test
 * re-runs today's post-processing over that real output.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume, enforceSkillEvidence, SYSTEM_PROMPT } from "@/lib/resume-generation";
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

function load(id: string) {
  const s = scenarios.find((x) => x.id === id)!;
  const profile = structuredClone(read<ProfileFixture>(`fixtures/profiles/${PROFILE_FILES[s.profile]}`));
  Object.assign(profile.user_profile, usableSections(profile.user_profile));
  const jd = read<JdFixture>(`fixtures/jds/${JD_FILES[s.jd]}`);
  const cap = read<{ final_resume: GeneratedResume }>(`captured/live-before/${id}.json`);
  const after = postProcessResume(cap.final_resume, profile.user_profile);
  return { s, profile, jd, before: cap.final_resume, after: after.resume as GeneratedResume, warnings: after.warnings };
}

const NOW = new Date("2026-09-24T08:00:00Z");

describe("the guard removes every unsupported claim from the real live output", () => {
  it.each(scenarios.map((s) => s.id))("%s: factual fidelity passes and keyword precision is 1", (id) => {
    const { s, profile, jd, after } = load(id);
    const ev = evaluateResume(profile, jd, s, after, NOW);
    expect(ev.gates.find((g) => g.gate === "factual_fidelity")!.defects).toEqual([]);
    expect(ev.metrics.keyword_precision).toBe(1);
  });

  it.each(scenarios.map((s) => s.id))("%s: truthful keyword recall is not reduced", (id) => {
    const { s, profile, jd, before, after } = load(id);
    const recallBefore = evaluateResume(profile, jd, s, before, NOW).metrics.keyword_recall;
    const recallAfter = evaluateResume(profile, jd, s, after, NOW).metrics.keyword_recall;
    expect(recallAfter).toBeGreaterThanOrEqual(recallBefore);
  });
});

describe("specific live defects", () => {
  it("S11: Python, C++ and GCP (listed as missing in the same resume) leave the skills", () => {
    const { before, after } = load("S11");
    expect(before.skills).toEqual(expect.arrayContaining(["Python", "C++", "GCP"]));
    expect(after.skills).not.toEqual(expect.arrayContaining(["Python"]));
    expect(after.skills).not.toContain("C++");
    expect(after.skills).not.toContain("GCP");
    expect(after.skills).toEqual(expect.arrayContaining(["Java", "JavaScript", "Spring Boot", "React", "Kafka"]));
  });

  it("S08: the QA engineer is no longer 'proficient in' DSA, OOD and distributed systems", () => {
    const { after } = load("S08");
    for (const s of ["Data Structures", "Algorithms", "Distributed Systems", "Object-Oriented Design"]) {
      expect(after.skills).not.toContain(s);
    }
    expect(after.summary).not.toMatch(/Proficient in Data Structures/);
    expect(after.skills).toEqual(expect.arrayContaining(["C", "C++", "Python", "pytest", "BLE"]));
  });

  it("S01: invented project tech is dropped, real tech kept", () => {
    const { after } = load("S01");
    const library = after.projects!.find((p) => p.name!.startsWith("Campus Library"))!;
    expect(library.tech).not.toContain("Data Structures");
    expect(library.tech).toEqual(expect.arrayContaining(["Java", "Spring Boot", "MySQL"]));
  });

  it("S04: a bullet that gained 'object-oriented design principles' reverts to the candidate's own words", () => {
    const { profile, after, warnings } = load("S04");
    const src = profile.user_profile.experience![0].bullets[0];
    expect(after.experience![0].bullets).toContain(src);
    expect(warnings.join()).toMatch(/reverted_bullet_unsupported_skill/);
  });

  it("S04: evidenced DSA stays (B lists Data Structures and Algorithms)", () => {
    expect(load("S04").after.skills).toEqual(expect.arrayContaining(["Data Structures", "Algorithms"]));
  });

  it("S10: 'algorithm-optimised' (hyphenated) is caught and the bullet reverted", () => {
    const { after } = load("S10");
    expect(after.experience![0].bullets!.join(" ")).not.toMatch(/algorithm/i);
  });

  it("S06: evidenced Code Review is kept", () => {
    expect(load("S06").after.skills).toContain("Code Review");
  });

  it("S07: the empty projects array and its section_order entry are removed", () => {
    const { before, after } = load("S07");
    expect(before.projects).toEqual([]);
    expect(after.projects).toBeUndefined();
    expect(after.section_order).not.toContain("projects");
  });

  it("never tells a candidate to add a skill they already have", () => {
    for (const id of scenarios.map((s) => s.id)) {
      const { profile, jd, s, after } = load(id);
      const d = evaluateResume(profile, jd, s, after, NOW).gates.find((g) => g.gate === "ats_keywords")!.defects.join();
      expect({ id, d }).toEqual({ id, d: expect.not.stringMatching(/already have/) });
    }
  });
});

describe("the guard leaves faithful output alone", () => {
  it("a resume using only profile evidence is unchanged", () => {
    const C = read<ProfileFixture>(`fixtures/profiles/${PROFILE_FILES.C}`).user_profile;
    const faithful = {
      section_order: ["summary", "experience", "skills", "education"],
      summary: "Software Engineer with 3 years building Java and Spring Boot microservices. Seeking the Software Development Engineer II role.",
      experience: C.experience!.map((e) => ({ ...e })),
      skills: ["Java", "Spring Boot", "Microservices", "MySQL", "Code Review"],
      education: C.education!.map((e) => ({ ...e })),
      ats_score: 70, matched_keywords: ["Code Review"], missing_keywords: ["Distributed Systems"],
    };
    const r = enforceSkillEvidence(structuredClone(faithful) as never, C);
    expect(r.warnings).toEqual([]);
    expect(r.resume).toEqual(faithful);
  });
});

describe("prompt rules", () => {
  it("adds evidence-only skills (H) and title/level honesty (I)", () => {
    expect(SYSTEM_PROMPT).toMatch(/H\. SKILLS ARE EVIDENCE-ONLY/);
    expect(SYSTEM_PROMPT).toMatch(/I\. TITLE AND LEVEL/);
    expect(SYSTEM_PROMPT).toMatch(/ats_score must not exceed 55/);
  });

  it("drops the rules that pushed JD keywords into every bullet and the title into sentence 1", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Contains zero TARGET_KEYWORDS/);
    expect(SYSTEM_PROMPT).not.toMatch(/Top 3 hard skills appear in skills AND in at least one bullet each\./);
    expect(SYSTEM_PROMPT).not.toMatch(/Sentence 1 contains the exact JD job title verbatim/);
  });
});
