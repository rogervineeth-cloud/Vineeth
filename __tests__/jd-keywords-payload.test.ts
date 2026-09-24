/**
 * JD keyword extraction and the INTERSECTION / JD_ONLY split — found by the
 * resume-quality eval (evals/resume-quality, results/before-offline.md).
 *
 * The split decides what the model may say: INTERSECTION_SKILLS must be
 * included, JD_ONLY_SKILLS must NEVER be claimed. Three defects meant truthful
 * evidence never reached the model as "include this":
 *
 *   1. The create page's extractor had no CS fundamentals or practice terms,
 *      so data structures, algorithms, code review, system design, etc. —
 *      the core of Google/Amazon SWE postings — were never proposed.
 *   2. Its boundary treated "." as part of a token, so any skill ending a
 *      sentence ("...data structures or algorithms.") was invisible.
 *   3. The server compared curated keywords with the skills list by exact
 *      string, so "ReactJS", "RESTful APIs", "Data Structures and
 *      Algorithms", or code reviews shown only in a bullet, were classed
 *      JD_ONLY — the model told never to claim them, the candidate told they
 *      were missing.
 *
 * The evidence-based split must not create the opposite error: a skill the
 * candidate does NOT have must never become a must-include. Ordinary English
 * ("go live", "express interest", "excel at") is covered explicitly.
 */
import * as fs from "fs";
import * as path from "path";
import { analyzeJd, detectTechSkills } from "@/lib/jd-keywords";
import { buildGenerationPayload, type GenerationProfile } from "@/lib/resume-generation";

const fixture = (rel: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evals", "resume-quality", "fixtures", rel), "utf8"));

describe("detectTechSkills", () => {
  it.each([
    ["experience with data structures or algorithms.", ["Data Structures", "Algorithms"]],
    ["Experience developing accessible technologies.", ["Accessibility"]],
    ["Built it with Java.", ["Java"]],
    ["Deployed to Kubernetes, AWS.", ["AWS", "Kubernetes"]],
  ])("finds a skill at the end of a sentence: %s", (text, expected) => {
    expect(detectTechSkills(text).sort()).toEqual([...expected].sort());
  });

  it("keeps dotted names whole", () => {
    expect(detectTechSkills("We use Node.js and React.js.").sort()).toEqual(["Node.js", "React"]);
  });

  it.each([
    ["Ready to go live next week.", "Go"],
    ["Candidates should express interest early.", "Express"],
    ["A swift response to incidents.", "Swift"],
    ["We communicate on slack daily.", "Slack"],
    ["I excel at testing.", "Excel"],
    ["Excel at stakeholder communication.", "Excel"],
  ])("does not read English prose as a skill: %s", (text, skill) => {
    expect(detectTechSkills(text)).not.toContain(skill);
  });

  it("still finds the capitalised technology", () => {
    expect(detectTechSkills("Languages: Java, C++, Python, or Go.")).toContain("Go");
    expect(detectTechSkills("Built Excel dashboards.")).toContain("Excel");
  });

  it.each([
    ["Strong DSA practice", "Data Structures"],
    ["OOPS concepts", "Object-Oriented Design"],
    ["Review code developed by other developers", "Code Review"],
    ["ran code reviews", "Code Review"],
    ["large-scale system design", "System Design"],
    ["A11y audit helper", "Accessibility"],
    ["split into 4 microservices", "Microservices"],
  ])("recognises fundamentals and practice terms: %s", (text, skill) => {
    expect(detectTechSkills(text)).toContain(skill);
  });
});

describe("analyzeJd on the eval JD fixtures", () => {
  it("proposes the fundamentals a Google SWE II posting is built on", () => {
    const { keywords } = analyzeJd(fixture("jds/google-swe2-cloud-bengaluru.json").text);
    expect(keywords).toEqual(expect.arrayContaining([
      "Java", "C++", "Python", "Go", "GCP", "Data Structures", "Algorithms", "Distributed Systems", "System Design", "Code Review", "Accessibility",
    ]));
    expect(keywords.length).toBeLessThanOrEqual(12);
  });

  it("proposes the design/architecture requirements of an Amazon SDE II posting", () => {
    const { keywords } = analyzeJd(fixture("jds/amazon-sde2-10533780.json").text);
    expect(keywords).toEqual(expect.arrayContaining(["Java", "AWS", "Distributed Systems", "Design Patterns", "Code Review"]));
  });
});

describe("buildGenerationPayload — evidence-based INTERSECTION / JD_ONLY", () => {
  const split = (profile: GenerationProfile, jd_keywords: string[]) => {
    const p = buildGenerationPayload({ jd_text: "x".repeat(120), jd_keywords, user_profile: profile });
    return { inter: p.INTERSECTION_SKILLS, only: p.JD_ONLY_SKILLS, extras: p.PROFILE_EXTRA_SKILLS };
  };

  it("B: ReactJS, RESTful APIs and 'Data Structures and Algorithms' count as React, REST API, DS, Algorithms", () => {
    const B = fixture("profiles/B-recent-grad-intern.json").user_profile;
    const r = split(B, ["Java", "React", "REST API", "Data Structures", "Algorithms", "Kubernetes"]);
    expect(r.inter).toEqual(["Java", "React", "REST API", "Data Structures", "Algorithms"]);
    expect(r.only).toEqual(["Kubernetes"]);
    // Already represented by a curated keyword → not repeated as an extra.
    expect(r.extras).not.toEqual(expect.arrayContaining(["ReactJS"]));
    expect(r.extras).not.toContain("RESTful APIs");
    expect(r.extras).not.toContain("Data Structures and Algorithms");
    expect(r.extras).toEqual(expect.arrayContaining(["Spring Boot", "MySQL", "Git"]));
  });

  it("C: code reviews evidenced only in a bullet → Code Review may be claimed", () => {
    const C = fixture("profiles/C-experienced-backend.json").user_profile;
    expect(split(C, ["Code Review", "Microservices", "AWS"])).toMatchObject({
      inter: ["Code Review", "Microservices"],
      only: ["AWS"],
    });
  });

  it("E: an accessibility project evidences Accessibility", () => {
    const E = fixture("profiles/E-multi-role-fullstack.json").user_profile;
    expect(split(E, ["Accessibility", "GCP"]).inter).toEqual(["Accessibility"]);
  });

  it("a keyword the candidate typed is matched verbatim in their evidence", () => {
    const A = fixture("profiles/A-fresher-projects.json").user_profile;
    expect(split(A, ["Razorpay", "Stripe"])).toMatchObject({ inter: ["Razorpay"], only: ["Stripe"] });
  });

  it("never turns English prose into a must-include skill", () => {
    const profile: GenerationProfile = {
      skills: ["Java"],
      experience: [{
        company: "Acme", role: "Engineer", duration: "Jan 2024 - Present", location: "",
        bullets: ["Helped the team go live with the release.", "Handled clients who express interest; excel at follow-ups."],
      }],
      projects: [],
    };
    const r = split(profile, ["Java", "Go", "Express", "Excel"]);
    expect(r.inter).toEqual(["Java"]);
    expect(r.only).toEqual(["Go", "Express", "Excel"]);
  });

  it("no skill is both included and forbidden, and every curated keyword lands somewhere", () => {
    const D = fixture("profiles/D-career-returner.json").user_profile;
    const curated = ["C++", "Python", "Java", "C#", "Data Structures", "Code Review"];
    const r = split(D, curated);
    expect(r.inter.filter((k) => r.only.includes(k))).toEqual([]);
    expect([...r.inter, ...r.only].sort()).toEqual([...curated].sort());
    expect(r.inter).toEqual(["C++", "Python"]);
  });
});
