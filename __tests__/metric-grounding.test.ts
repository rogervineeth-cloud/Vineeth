/**
 * Metric grounding is per entry, and an invented metric reverts the bullet —
 * live resume-quality run, S10, 2026-09-24.
 *
 *   1. A QA-role bullet claimed "identifying and documenting 5 performance
 *      bottlenecks". "5" was accepted because it appears elsewhere in the
 *      profile ("Containerised 5 services", a different job). Numbers are now
 *      grounded in the SAME role (its bullets and dates) or the SAME project.
 *   2. A bullet with an invented metric was dropped outright, losing the
 *      candidate's true "Containerised 5 services ... Kubernetes" bullet. It
 *      now reverts to the candidate's own source bullet.
 */
import * as fs from "fs";
import * as path from "path";
import { sanitiseGeneratedResume, type ResumeShape } from "@/lib/sanitise-resume";
import { postProcessResume } from "@/lib/resume-generation";

const ROOT = path.join(__dirname, "..", "evals", "resume-quality");
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const E = read("fixtures/profiles/E-multi-role-fullstack.json").user_profile;
const C = read("fixtures/profiles/C-experienced-backend.json").user_profile;
const A = read("fixtures/profiles/A-fresher-projects.json").user_profile;

const sanitise = (resume: unknown, profile: typeof E) =>
  sanitiseGeneratedResume(structuredClone(resume) as ResumeShape, {
    summary: profile.summary, experience: profile.experience, education: profile.education,
    projects: profile.projects, skills: profile.skills,
  });

const qa = E.experience[1];
const orbit = E.experience[0];

describe("numbers are grounded in their own role", () => {
  it("live S10: '5 performance bottlenecks' in the QA role is rejected although '5' exists in another job", () => {
    const r = sanitise({ experience: [{ ...qa, bullets: ["Executed JMeter load tests for high-traffic festive-sale release, identifying and documenting 5 performance bottlenecks."] }] }, E);
    expect(r.resume.experience![0].bullets).toEqual(["Ran JMeter load tests for the festive-sale release."]);
    expect(r.warnings).toEqual(["reverted_bullet_unverifiable_metric:5"]);
  });

  it("the live S10 capture, re-processed, carries no borrowed number", () => {
    const cap = read("captured/live-after/S10.json");
    const out = postProcessResume(cap.final_resume, E).resume as ResumeShape;
    const qaBullets = out.experience!.find((x) => x.company === "Brightline Retail Tech")!.bullets!;
    expect(qaBullets.join(" ")).not.toMatch(/\b5\b/);
    expect(qaBullets).toContain("Ran JMeter load tests for the festive-sale release.");
  });

  it("numbers from the role's own bullets stay (C: 800 ms -> 350 ms)", () => {
    const b = "Reduced p95 latency of the settlement API from 800 ms to 350 ms using Redis caching.";
    const r = sanitise({ experience: [{ ...C.experience[0], bullets: [b] }] }, C);
    expect(r.resume.experience![0].bullets).toEqual([b]);
    expect(r.warnings).toEqual([]);
  });

  it("a number from education or another role cannot be borrowed (CGPA 8.4, a 2019 year, '6 hours')", () => {
    const r = sanitise({ experience: [{ ...C.experience[0], bullets: [
      "Mentored 8 junior engineers and ran code reviews in 2-week Agile sprints.",
      "Reduced p95 latency of the settlement API by 6 hours of effort a week.",
    ] }] }, C);
    expect(r.warnings.every((w) => w.startsWith("reverted_bullet_unverifiable_metric"))).toBe(true);
    expect(r.resume.experience![0].bullets).toEqual(expect.arrayContaining([C.experience[0].bullets[2], C.experience[0].bullets[0]]));
  });
});

describe("an invented metric reverts the bullet instead of deleting it", () => {
  it("E: 'Containerised 5 services ... cutting deploy time by 60%' reverts to the true bullet", () => {
    const r = sanitise({ experience: [{ ...orbit, bullets: [
      "Containerised 5 services with Docker and deployed them to Kubernetes on AWS, cutting deploy time by 60%.",
    ] }] }, E);
    expect(r.resume.experience![0].bullets).toEqual(["Containerised 5 services with Docker and deployed them to Kubernetes on AWS."]);
    expect(r.warnings).toEqual(["reverted_bullet_unverifiable_metric:60"]);
  });

  it("two rewrites of the same source bullet collapse to one copy", () => {
    const r = sanitise({ experience: [{ ...orbit, bullets: [
      "Containerised 5 services with Docker on Kubernetes, cutting costs by 40%.",
      "Containerised 5 services with Docker and deployed them to Kubernetes on AWS, saving 60% time.",
    ] }] }, E);
    expect(r.resume.experience![0].bullets).toEqual(["Containerised 5 services with Docker and deployed them to Kubernetes on AWS."]);
  });

  it("with no identifiable source, the bullet is still dropped", () => {
    const r = sanitise({ experience: [{ ...orbit, bullets: ["Negotiated 3 vendor contracts worth 90 lakh."] }] }, E);
    expect(r.resume.experience![0].bullets).toEqual([]);
    expect(r.warnings[0]).toMatch(/^dropped_bullet_unverifiable_metric/);
  });
});

describe("project numbers are grounded in that project", () => {
  it("A: a number from another project ('120') cannot appear in PaySplit", () => {
    const r = sanitise({ projects: [{ name: A.projects[0].name, description: "Split expenses for 120 users with a Spring Boot API.", tech: ["Java"] }] }, A);
    expect(r.resume.projects![0].description).toBe(A.projects[0].description);
  });

  it("A: PaySplit's own '40 JUnit tests' stays", () => {
    const d = "Spring Boot and React app with 40 JUnit tests and Razorpay webhooks.";
    const r = sanitise({ projects: [{ name: A.projects[0].name, description: d, tech: ["Java"] }] }, A);
    expect(r.resume.projects![0].description).toBe(d);
  });
});
