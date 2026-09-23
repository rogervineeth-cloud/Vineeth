/**
 * Free-review scoring — the production defect class and its guards.
 *
 * Reported from production: a resume listing Java, Spring Boot, React, AWS,
 * Docker, PostgreSQL, REST APIs, microservices and CI/CD, compared against a
 * JD naming those plus TypeScript/Kubernetes/JUnit/Agile, returned ATS 26,
 * "0 skills overlap", and missing keywords like "software engineer.",
 * "REST APIs." and adjacent pairs such as "react typescript".
 *
 * Three root causes, each pinned below:
 *
 *   1. Tokens kept their trailing punctuation, so sentence-final words became
 *      "engineer." and never matched anything.
 *   2. skills_overlap read extractProfile().skills, which only finds skills
 *      under a recognised section header — so the same content scored
 *      differently purely by formatting, and an unstructured paste reported
 *      no overlap at all.
 *   3. Every adjacent word pair was a candidate keyword at 2x weight, so
 *      artefacts of a comma list ("react typescript", "aws docker",
 *      "docker kubernetes") outranked the real skills.
 *
 * The false-positive controls matter as much as the fixes: a scorer that
 * tells someone they already have Kubernetes is worse than one that says
 * nothing.
 */
import { scoreFree, detectSkills, extractJdKeywords, trimPunctuation } from "@/lib/score-free";

const JD = `We are hiring a Senior Software Engineer.
You will build Java and Spring Boot microservices and REST APIs.
Experience with React, TypeScript, AWS, Docker, Kubernetes and PostgreSQL is required.
You should know JUnit testing, CI/CD pipelines and Agile delivery.`;

/** Same person, same facts, three formattings users actually paste. */
const WITH_SKILLS_SECTION = `Rahul Krishnan
rahul.test@example.com | +91 98765 43210 | Thiruvananthapuram

Summary
Senior Software Engineer with 10 years building Java and Spring Boot microservices.

Experience
UST Global - Senior Software Engineer
Jun 2018 - Present
- Built REST APIs in Java and Spring Boot serving 2M requests per day.
- Migrated 12 microservices to AWS with Docker and CI/CD pipelines.
- Designed PostgreSQL schemas and optimised slow queries by 40%.

Skills
Java, Spring Boot, React, AWS, Docker, PostgreSQL, REST APIs, microservices, CI/CD

Education
College of Engineering Trivandrum
B.Tech Computer Science, 2014`;

const SKILLS_IN_PROSE = `Rahul Krishnan
rahul.test@example.com

Senior Software Engineer with 10 years of experience in Java, Spring Boot, React,
AWS, Docker, PostgreSQL, REST APIs, microservices and CI/CD.

UST Global - Senior Software Engineer (Jun 2018 - Present)
Built REST APIs in Java and Spring Boot serving 2M requests per day.`;

const UNSTRUCTURED_BLOB = `Rahul Krishnan, Senior Software Engineer, Thiruvananthapuram.
Ten years building backend systems with Java, Spring Boot, React, AWS, Docker,
PostgreSQL, REST APIs, microservices and CI/CD. Delivered large migrations.`;

const ALL_THREE = [
  ["with a Skills section", WITH_SKILLS_SECTION],
  ["with skills in prose", SKILLS_IN_PROSE],
  ["as an unstructured blob", UNSTRUCTURED_BLOB],
] as const;

describe("punctuation no longer fragments keywords", () => {
  it.each([
    ["engineer.", "engineer"],
    ["APIs.", "APIs"],
    ["delivery.", "delivery"],
    ["-Java", "Java"],
    ["(React)", "React"],
  ])("trims %s to %s", (input, expected) => {
    expect(trimPunctuation(input)).toBe(expected);
  });

  it("keeps punctuation that is part of the skill itself", () => {
    expect(trimPunctuation("node.js")).toBe("node.js");
    expect(trimPunctuation("ci/cd")).toBe("ci/cd");
    expect(trimPunctuation("c++")).toBe("c++");
    expect(trimPunctuation("c#")).toBe("c#");
  });

  it("produces no keyword ending in a full stop", () => {
    for (const kw of extractJdKeywords(JD)) {
      expect({ kw, endsWithStop: /\.$/.test(kw) && !kw.includes(".js") }).toEqual({
        kw, endsWithStop: false,
      });
    }
  });

  it("never reports the exact fragments seen in production", () => {
    const r = scoreFree(WITH_SKILLS_SECTION, JD);
    const all = [...r.missing_keywords, ...r.matched_keywords].map((s) => s.toLowerCase());
    for (const bad of ["software engineer.", "rest apis.", "engineer.", "agile delivery."]) {
      expect({ bad, present: all.includes(bad) }).toEqual({ bad, present: false });
    }
  });
});

describe("skills overlap is read from the whole resume, not a section header", () => {
  it.each(ALL_THREE)("reports genuine overlap %s", (_label, resume) => {
    const r = scoreFree(resume, JD);
    // The headline production symptom was "0 skills overlap" on content that
    // plainly listed the skills.
    expect(r.skills_overlap.length).toBeGreaterThanOrEqual(7);
    for (const skill of ["Java", "Spring Boot", "React", "AWS", "Docker", "PostgreSQL", "REST API", "Microservices"]) {
      expect({ skill, overlapping: r.skills_overlap.includes(skill) }).toEqual({ skill, overlapping: true });
    }
  });

  it("does not swing wildly on formatting alone", () => {
    const scores = ALL_THREE.map(([, resume]) => scoreFree(resume, JD).ats_score);
    // Before: 42 / 52 / 72 — a 30-point spread for identical content.
    expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(22);
  });

  it("reports CI/CD as one skill rather than 'ci' and 'cd'", () => {
    const r = scoreFree(WITH_SKILLS_SECTION, JD);
    expect(r.skills_overlap).toContain("CI/CD");
    expect(r.skills_overlap).not.toContain("ci");
    expect(r.skills_overlap).not.toContain("cd");
  });
});

describe("missing terms are candidate-actionable", () => {
  it("names exactly the skills the JD asks for and the resume lacks", () => {
    const r = scoreFree(WITH_SKILLS_SECTION, JD);
    expect(r.missing_keywords.sort()).toEqual(["Agile", "JUnit", "Kubernetes", "TypeScript"]);
  });

  it("contains no arbitrary adjacent word pairs", () => {
    const r = scoreFree(WITH_SKILLS_SECTION, JD);
    for (const bad of ["react typescript", "typescript aws", "aws docker", "docker kubernetes", "build java", "testing ci/cd"]) {
      expect({ bad, present: r.missing_keywords.map((m) => m.toLowerCase()).includes(bad) })
        .toEqual({ bad, present: false });
    }
  });

  it("offers no generic filler as a missing skill", () => {
    const r = scoreFree(WITH_SKILLS_SECTION, JD);
    for (const filler of ["build", "delivery", "testing", "pipelines", "software", "engineer"]) {
      expect({ filler, present: r.missing_keywords.map((m) => m.toLowerCase()).includes(filler) })
        .toEqual({ filler, present: false });
    }
  });
});

describe("alias and plural normalisation", () => {
  it.each([
    ["REST APIs", "REST API"],
    ["RESTful APIs", "REST API"],
    ["Postgres", "PostgreSQL"],
    ["K8s", "Kubernetes"],
    ["NodeJS", "Node.js"],
    ["microservice", "Microservices"],
    ["continuous integration", "CI/CD"],
    ["springboot", "Spring Boot"],
  ])("%s is recognised as %s", (surface, canonical) => {
    expect(detectSkills(`Experienced with ${surface} in production.`)).toContain(canonical);
  });

  it("matches a resume's plural against a JD's singular", () => {
    const r = scoreFree("I build REST APIs and microservices every day.", "You will build a REST API and a microservice.");
    expect(r.skills_overlap).toEqual(expect.arrayContaining(["REST API", "Microservices"]));
  });
});

// ── FALSE-POSITIVE CONTROLS ────────────────────────────────────────────────
// Claiming a skill the candidate does not have is worse than missing one.
describe("false-positive controls", () => {
  it("does not read Java out of JavaScript", () => {
    const skills = detectSkills("Frontend developer working in JavaScript and TypeScript.");
    expect(skills).toContain("JavaScript");
    expect(skills).not.toContain("Java");
  });

  it("does not read REST out of RESTful prose fragments", () => {
    expect(detectSkills("The team took a well-earned rest after the release.")).not.toContain("REST API");
  });

  it("does not read React out of ordinary English", () => {
    expect(detectSkills("I react quickly to production incidents and reacted well under pressure."))
      .not.toContain("React");
  });

  it("does not read Spring out of a date or a season", () => {
    expect(detectSkills("Joined in Spring 2019 as a graduate trainee.")).not.toContain("Spring Boot");
  });

  it("does not credit a skill that only the JD mentions", () => {
    const r = scoreFree("Java and Spring Boot developer.", JD);
    expect(r.skills_overlap).not.toContain("Kubernetes");
    expect(r.skills_overlap).not.toContain("TypeScript");
    expect(r.missing_keywords).toEqual(expect.arrayContaining(["Kubernetes", "TypeScript"]));
  });

  it("does not report Scrum when only Agile is present", () => {
    // Deliberately NOT aliased: they are different things and conflating them
    // would tell a candidate they already have something they do not.
    const skills = detectSkills("Worked in an Agile environment for four years.");
    expect(skills).toContain("Agile");
    expect(skills).not.toContain("Scrum");
  });

  it("stays empty on text with no skills at all", () => {
    expect(detectSkills("I enjoy long walks and cooking for my family.")).toEqual([]);
  });
});

describe("determinism and shape are preserved", () => {
  it("is deterministic across runs", () => {
    expect(scoreFree(WITH_SKILLS_SECTION, JD)).toEqual(scoreFree(WITH_SKILLS_SECTION, JD));
  });

  it("keeps ats_score an integer within 0..100", () => {
    for (const [, resume] of ALL_THREE) {
      const s = scoreFree(resume, JD).ats_score;
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("does not throw on empty input", () => {
    expect(() => scoreFree("", "")).not.toThrow();
  });
});
