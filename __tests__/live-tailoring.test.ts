/**
 * Live tailoring / PDF-readiness scoring (evals/resume-quality/live-tailoring.ts).
 */
import * as fs from "fs";
import * as path from "path";
import { tailoringReport, pdfReport } from "../evals/resume-quality/live-tailoring";
import type { ProfileFixture, GeneratedResume } from "../evals/resume-quality/evaluate";

const ROOT = path.join(__dirname, "..", "evals", "resume-quality");
const C = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/profiles/C-experienced-backend.json"), "utf8")) as ProfileFixture;
const up = C.user_profile;
const role = up.experience![1];

describe("tailoringReport", () => {
  const raw: GeneratedResume = {
    summary: "Backend engineer with 3 years building Java and Spring Boot microservices for payments. Scalable systems wizard.",
    experience: [{ company: role.company, role: role.role, duration: role.duration, bullets: [
      "Automated nightly reconciliation reports using Spring Boot batch jobs, saving the operations team 6 hours a week.",
      "Implemented MySQL schema changes and JPA/Hibernate repositories for the merchant onboarding service, improving reliability.",
    ] }],
  };
  const final: GeneratedResume = {
    summary: "Backend engineer with 3 years building Java and Spring Boot microservices for payments.",
    experience: [{ company: role.company, role: role.role, duration: role.duration, bullets: [
      role.bullets[1],
      "Implemented MySQL schema changes and JPA/Hibernate repositories for the merchant onboarding service.",
    ] }],
  };
  const t = tailoringReport(up, "Software Development Engineer II", final, raw);

  it("separates verbatim source bullets from clean tailored ones", () => {
    expect(t).toMatchObject({ bullets_final: 2, bullets_verbatim_source: 1, bullets_tailored_clean: 1, bullets_tailored_unclean: 0 });
  });

  it("classifies what happened to each raw rewrite", () => {
    expect(t.raw).toEqual({ rewritten: 2, rewritten_clean: 0, kept: 0, trimmed: 1, reverted: 1, dropped: 0 });
  });

  it("tracks the summary: kept sentence, dropped sentence, own-summary use, role naming", () => {
    expect(t.raw_summary).toEqual({ sentences: 2, kept: 1, trimmed: 0, dropped: 1 });
    expect(t.summary_uses_own_summary).toBe(true);
    expect(t.summary_names_target).toBe(false);
  });
});

describe("pdfReport", () => {
  it("renders with the production renderer in every template", async () => {
    const r = await pdfReport({ summary: "Backend engineer.", experience: [{ ...role, bullets: role.bullets }], skills: ["Java"], education: up.education } as GeneratedResume, { full_name: up.full_name, email: up.email });
    expect(r.ok).toBe(true);
    expect(Object.values(r.pages)).toEqual([1, 1, 1, 1]);
  });

  it("reports text the standard PDF fonts cannot encode as not ready", async () => {
    const r = await pdfReport({ summary: "Engineer → lead ✓", skills: ["Java"] } as GeneratedResume, { full_name: "Test" });
    expect(r.ok).toBe(false);
  });
});
