/**
 * The resume-quality evaluator must catch what it claims to catch. Each test
 * feeds it a synthetic resume with one planted defect (or none) built from the
 * real fixtures, and checks the right gate — and only that gate — fails.
 */
import * as fs from "fs";
import * as path from "path";
import {
  evaluateResume,
  evaluatePayload,
  skillsIn,
  type ProfileFixture,
  type JdFixture,
  type Scenario,
  type GeneratedResume,
} from "../evals/resume-quality/evaluate";

const ROOT = path.join(__dirname, "..", "evals", "resume-quality");
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const P = (f: string) => read<ProfileFixture>(`fixtures/profiles/${f}`);
const J = (f: string) => read<JdFixture>(`fixtures/jds/${f}`);

const A = P("A-fresher-projects.json");
const B = P("B-recent-grad-intern.json");
const C = P("C-experienced-backend.json");
const D = P("D-career-returner.json");
const AMZ2 = J("amazon-sde2-10533780.json");
const AMZ = J("amazon-sde-2968029.json");
const GOOG = J("google-swe2-cloud-bengaluru.json");

const NOW = new Date("2026-09-24T00:00:00Z");
const sc = (fit: Scenario["expected_fit"]): Scenario => ({ id: "T", profile: "", jd: "", expected_fit: fit, why: "" });
const gate = (r: ReturnType<typeof evaluateResume>, g: string) => r.gates.find((x) => x.gate === g)!;
const failing = (r: ReturnType<typeof evaluateResume>) => r.gates.filter((g) => !g.pass).map((g) => g.gate);

/** A faithful resume for C against Amazon SDE II: every fact from the profile. */
function cleanC(): GeneratedResume {
  const up = C.user_profile;
  return {
    section_order: ["summary", "experience", "skills", "education"],
    summary:
      "Backend engineer with 3 years building Java and Spring Boot microservices for payments, applying for the Software Development Engineer II role. Mentors junior engineers and runs code reviews.",
    experience: up.experience!.map((e) => ({ ...e })),
    skills: ["Java", "Spring Boot", "Microservices", "MySQL", "JPA", "Hibernate", "REST APIs", "Agile", "Git", "Jenkins"],
    education: up.education!.map((e) => ({ institution: e.institution, degree: e.degree, year: e.year })),
    ats_score: 74,
    matched_keywords: ["Java"],
    missing_keywords: ["AWS"],
    tailored_role: "Software Development Engineer II",
    growth_note: null,
  };
}

describe("a faithful resume passes every gate", () => {
  it("C × Amazon SDE II", () => {
    const r = evaluateResume(C, AMZ2, sc("match"), cleanC(), NOW);
    expect(failing(r)).toEqual([]);
    expect(r.metrics.unsupported_claims).toBe(0);
    expect(r.metrics.keyword_precision).toBe(1);
    expect(r.interview_chance).toBe("strong");
  });
});

describe("factual fidelity", () => {
  it("catches a fabricated employer", () => {
    const res = cleanC();
    res.experience!.push({ company: "Infosys", role: "Senior Engineer", duration: "Jan 2022 - Jun 2023", bullets: ["Built APIs."] });
    const r = evaluateResume(C, AMZ2, sc("match"), res, NOW);
    expect(gate(r, "factual_fidelity").defects.join()).toMatch(/fabricated employer "Infosys"/);
    expect(r.interview_chance).toBe("weak");
  });

  it("catches an invented metric", () => {
    const res = cleanC();
    res.experience![0].bullets = [...res.experience![0].bullets!, "Improved throughput by 60% across 9 services."];
    const r = evaluateResume(C, AMZ2, sc("match"), res, NOW);
    expect(gate(r, "factual_fidelity").defects.join()).toMatch(/unverifiable number/);
  });

  it("catches a changed duration", () => {
    const res = cleanC();
    res.experience![1].duration = "Jan 2023 - Jun 2024";
    expect(gate(evaluateResume(C, AMZ2, sc("match"), res, NOW), "factual_fidelity").pass).toBe(false);
  });

  it("catches a JD-only skill claimed as the candidate's (keyword stuffing)", () => {
    const res = cleanC();
    res.skills!.push("AWS");
    res.summary += " Experienced with distributed systems on AWS.";
    const r = evaluateResume(C, AMZ2, sc("match"), res, NOW);
    expect(gate(r, "factual_fidelity").pass).toBe(false);
    expect(r.metrics.keyword_precision).toBeLessThan(1);
  });
});

describe("ATS keywords", () => {
  it("flags telling a candidate to add a skill they already have", () => {
    const res = cleanC();
    res.missing_keywords = ["Java"];
    expect(gate(evaluateResume(C, AMZ2, sc("match"), res, NOW), "ats_keywords").defects.join()).toMatch(/already have: Java/);
  });
});

describe("seniority calibration", () => {
  it("flags an inflated score, no growth note, and a claimed level for a fresher vs SDE II", () => {
    const res: GeneratedResume = {
      summary: "Software Development Engineer II with 3 years of Java and Spring Boot experience.",
      skills: ["Java", "Spring Boot"],
      education: A.user_profile.education!.map((e) => ({ institution: e.institution, degree: e.degree })),
      projects: A.user_profile.projects!.map((p) => ({ name: p.name, description: "Built with Java.", tech: p.tech })),
      ats_score: 82,
      growth_note: null,
    };
    const d = gate(evaluateResume(A, AMZ2, sc("mismatch"), res, NOW), "seniority_calibration").defects.join("\n");
    expect(d).toMatch(/ats_score 82 too high/);
    expect(d).toMatch(/no growth_note/);
    expect(d).toMatch(/overstates experience: "3 years" vs 0 professional years/);
    expect(d).toMatch(/presents the target title/);
  });

  it("accepts the target title when it is framed as the role being sought", () => {
    const res: GeneratedResume = {
      summary: "Computer Science graduate seeking the Software Development Engineer II role, with Java projects.",
      skills: ["Java"], education: [{ institution: A.user_profile.education![0].institution }],
      projects: [{ name: "PaySplit", description: "Java app.", tech: ["Java"] }],
      ats_score: 40, growth_note: "SDE II asks for 3+ years; this profile has projects only.",
    };
    expect(gate(evaluateResume(A, AMZ2, sc("mismatch"), res, NOW), "seniority_calibration").pass).toBe(true);
  });
});

describe("evaluator corrections found by reading live output", () => {
  it("'Mentored 2 engineers' evidences Mentoring", () => {
    const res = cleanC();
    res.summary += " Mentoring-minded engineer.";
    expect(gate(evaluateResume(C, AMZ2, sc("match"), res, NOW), "factual_fidelity").defects.join()).not.toMatch(/Mentoring/);
  });

  it("a derived years claim in the summary is not an unverifiable metric", () => {
    const res = cleanC();
    res.summary = "Backend engineer with 3+ years building Java services.";
    expect(gate(evaluateResume(C, AMZ2, sc("match"), res, NOW), "factual_fidelity").defects.join()).not.toMatch(/unverifiable number "3"/);
  });

  it("'<title> candidate' frames the target, but '<title> with N years' claims the level", () => {
    const base = { skills: ["Java"], education: [{ institution: A.user_profile.education![0].institution }], projects: [{ name: "PaySplit", description: "Java.", tech: ["Java"] }], ats_score: 40, growth_note: "x" };
    const ok = evaluateResume(A, AMZ2, sc("mismatch"), { ...base, summary: "Software Development Engineer II candidate with Java projects." }, NOW);
    const bad = evaluateResume(A, AMZ2, sc("mismatch"), { ...base, summary: "Software Development Engineer II with Java projects." }, NOW);
    expect(gate(ok, "seniority_calibration").defects.join()).not.toMatch(/target title/);
    expect(gate(bad, "seniority_calibration").defects.join()).toMatch(/target title/);
  });
});

describe("sections, readability", () => {
  it("flags dropped sections and empty arrays", () => {
    const res = cleanC();
    res.education = [];
    const d = gate(evaluateResume(C, AMZ2, sc("match"), res, NOW), "section_completeness").defects.join();
    expect(d).toMatch(/education dropped/);
    expect(d).toMatch(/empty "education" array/);
  });

  it("flags weak openers, first person, over-long bullets and non-ASCII", () => {
    const res = cleanC();
    res.experience![0].bullets = ["Responsible for my team’s settlement API – " + "x".repeat(230)];
    const d = gate(evaluateResume(C, AMZ2, sc("match"), res, NOW), "readability").defects.join("\n");
    expect(d).toMatch(/weak opener/);
    expect(d).toMatch(/first-person/);
    expect(d).toMatch(/over 220 chars/);
    expect(d).toMatch(/non-ASCII/);
  });
});

describe("career gap", () => {
  const baseD = (): GeneratedResume => ({
    summary: "QA engineer returning after an 8-month career break.",
    experience: D.user_profile.experience!.map((e) => ({ ...e })),
    skills: ["Python", "pytest", "BLE"],
    education: [{ institution: D.user_profile.education![0].institution }],
    projects: [{ name: "ESP32 BLE Sensor Logger", description: "C firmware on ESP32 with FreeRTOS.", tech: ["C"] }],
    ats_score: 40, growth_note: "Off-domain for this role.",
  });

  it("passes when the break is left visible", () => {
    expect(gate(evaluateResume(D, AMZ, sc("mismatch"), baseD(), NOW), "career_gap").pass).toBe(true);
  });

  it("catches employment stretched over the break", () => {
    const res = baseD();
    res.experience![0].duration = "Nov 2023 - Present";
    const r = evaluateResume(D, AMZ, sc("mismatch"), res, NOW);
    expect(gate(r, "career_gap").defects.join()).toMatch(/covers the career break/);
    expect(r.interview_chance).toBe("weak");
  });
});

describe("projects vs employment", () => {
  it("catches experience invented for a fresher and a project presented as a job", () => {
    const res: GeneratedResume = {
      summary: "Graduate engineer.", skills: ["Java"],
      education: [{ institution: A.user_profile.education![0].institution }],
      experience: [{ company: "PaySplit", role: "Founder", duration: "Jan 2025 - Jun 2025", bullets: ["Built it."] }],
      projects: [{ name: "Campus Library Reservations", description: "Java.", tech: ["Java"] }],
      ats_score: 40, growth_note: "x",
    };
    const d = gate(evaluateResume(A, AMZ, sc("under"), res, NOW), "projects_vs_employment").defects.join("\n");
    expect(d).toMatch(/presented as employment/);
    expect(d).toMatch(/no employment/);
  });

  it("catches an internship relabelled as a full-time role", () => {
    const res: GeneratedResume = {
      summary: "Backend developer.", skills: ["Java"],
      experience: [{ ...B.user_profile.experience![0], role: "Backend Developer" }],
      education: [{ institution: B.user_profile.education![0].institution }],
      projects: [{ name: "ShopEase", description: "Spring Boot store.", tech: ["Java"] }],
      ats_score: 50, growth_note: "x",
    };
    expect(gate(evaluateResume(B, AMZ, sc("under"), res, NOW), "projects_vs_employment").defects.join()).toMatch(/internship relabelled/);
  });
});

describe("skill vocabulary", () => {
  it("does not read the English word 'go' as the Go language", () => {
    expect(skillsIn("Ready to go live with the release.").has("Golang")).toBe(false);
    expect(skillsIn("Languages: Java, C++, Python, or Go.").has("Golang")).toBe(true);
  });

  it("C is found as a language but not inside C++ or C#", () => {
    expect(skillsIn("Firmware in C on ESP32").has("C")).toBe(true);
    expect(skillsIn("Services in C++ and C#").has("C")).toBe(false);
  });
});

describe("payload report", () => {
  it("measures must-inject coverage over every truthful JD requirement", () => {
    const r = evaluatePayload(B, AMZ);
    expect(r.attainable_skills).toEqual(["Algorithms", "Data Structures"]);
    expect(r.must_inject_coverage).toBe(1);
  });

  it("a language the posting names is attainable only if the candidate evidences it", () => {
    expect(evaluatePayload(B, GOOG).attainable_skills).toContain("Java");
    expect(evaluatePayload(B, GOOG).attainable_skills).not.toContain("Python");
  });
});

describe("the harness cannot touch credits or the database", () => {
  it.each(["run.ts", "evaluate.ts"])("%s has no direct import of lib/plans or lib/supabase", (f) => {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*lib\/(plans|supabase)/);
  });

  it("nothing in the harness's import graph loads lib/plans or lib/supabase", () => {
    jest.isolateModules(() => {
      jest.doMock("@/lib/plans", () => { throw new Error("eval harness imported lib/plans"); });
      jest.doMock("@/lib/supabase/server", () => { throw new Error("eval harness imported lib/supabase/server"); });
      jest.doMock("@/lib/supabase/client", () => { throw new Error("eval harness imported lib/supabase/client"); });
      // Everything run.ts imports (run.ts itself executes main() on load).
      // Synchronous require is what isolateModules + doMock need here.
      /* eslint-disable @typescript-eslint/no-require-imports */
      expect(() => {
        require("../evals/resume-quality/evaluate");
        require("@/lib/resume-generation");
        require("@/lib/profile-completeness");
        require("@/lib/models");
        require("@/lib/jd-keywords");
      }).not.toThrow();
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
  });

  it("uses the production generation functions, not a copy", () => {
    const src = fs.readFileSync(path.join(ROOT, "run.ts"), "utf8");
    expect(src).toMatch(/import \{ buildModelRequest, parseModelReply, postProcessResume \} from "@\/lib\/resume-generation"/);
    expect(src).toMatch(/MODEL_RESUME_STANDARD/);
  });
});
