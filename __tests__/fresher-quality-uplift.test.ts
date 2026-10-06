/**
 * Candidate-perceived quality for early-career resumes, without new facts.
 *
 * The production fresher PDF was ATS-safe and truthful but sparse: a
 * two-sentence summary, nothing under the name, a CGPA that never reached the
 * page (the prompt asked for "gpa", the renderer reads "cgpa" — all 11
 * final-live-7 captures lost it), project descriptions as grey paragraphs and
 * a page two-thirds empty. These tests pin the uplift and, above all, that it
 * adds no employer, institution, skill, number, method or outcome the
 * candidate did not give.
 */
import * as fs from "fs";
import * as path from "path";
import {
  postProcessResume,
  buildHeadline,
  enrichEarlyCareerSummary,
  enforceSourceCoverage,
  orderEarlyCareerSections,
  isEarlyCareer,
  type GenerationProfile,
} from "@/lib/resume-generation";
import { computeFacts } from "@/lib/profile-facts";
import { sanitiseGeneratedResume, extractNumbers } from "@/lib/sanitise-resume";
import { layoutResumePdf, formatGrade, descriptionBullets, type ResumeJson, type DrawnText } from "@/lib/resume-pdf";
import { usableSections } from "@/lib/profile-completeness";
import { detectTechSkills } from "@/lib/jd-keywords";
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
const TEMPLATES = ["classic", "modern", "compact", "executive"] as const;

function profileOf(key: string): ProfileFixture {
  const p = read<ProfileFixture>(`fixtures/profiles/${PROFILES[key]}`);
  Object.assign(p.user_profile, usableSections(p.user_profile));
  return p;
}

function replay(id: string) {
  const s = scenarios.find((x) => x.id === id)!;
  const profile = profileOf(s.profile);
  const jd = read<JdFixture>(`fixtures/jds/${JDS[s.jd]}`);
  const cap = read<{ raw_resume: GeneratedResume; final_resume: GeneratedResume }>(`captured/live-final-7/${id}.json`);
  const out = postProcessResume(structuredClone(cap.raw_resume), profile.user_profile, { now: NOW });
  return { s, profile, jd, cap, resume: out.resume as GeneratedResume, warnings: out.warnings };
}

/** What the download route does before rendering. */
const asDownloaded = (r: unknown) =>
  JSON.parse(JSON.stringify(r).replace(/[–—]/g, "-").replace(/[^\x00-\xFF]/g, "")) as ResumeJson;

const contactOf = (p: ProfileFixture) => {
  const u = p.user_profile as Record<string, string>;
  return { full_name: u.full_name, email: u.email, phone: u.phone, current_city: u.current_city };
};

const sentences = (t: string) => t.trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
const EARLY = ["S01", "S02", "S03", "S04", "S05"];

// ── Generation: every captured live reply, replayed ────────────────────────

describe("all 11 final-live-7 replies, replayed through the uplifted pipeline", () => {
  it.each(scenarios.map((s) => s.id))("%s: every fidelity gate passes, the headline included", (id) => {
    const { s, profile, jd, resume } = replay(id);
    const gates = evaluateResume(profile, jd, s, resume, NOW).gates.filter((g) => g.gate !== "seniority_calibration");
    for (const g of gates) expect({ id, gate: g.gate, defects: g.defects }).toEqual({ id, gate: g.gate, defects: [] });
    expect(typeof resume.headline).toBe("string");
  });

  it.each(scenarios.map((s) => s.id))("%s: institution, degree, year and CGPA are the candidate's own, verbatim", (id) => {
    const { profile, resume } = replay(id);
    const own = profile.user_profile.education ?? [];
    for (const e of (resume.education ?? []) as Array<Record<string, string>>) {
      const src = own.find((o) => o.institution === e.institution);
      expect(src).toBeDefined();
      expect({ degree: e.degree, year: e.year, cgpa: e.cgpa }).toEqual({ degree: src!.degree, year: src!.year, cgpa: src!.cgpa });
      expect(e).not.toHaveProperty("gpa");
    }
  });

  it("the CGPA the captured replies dropped is now shown on the page", () => {
    const { cap, profile, resume } = replay("S01");
    // Captured: the model's "gpa" key, which the renderer never read.
    expect((cap.final_resume.education as Array<Record<string, string>>)[0].gpa).toBe("8.1");
    const before = (cap.final_resume.education as Array<Record<string, string>>)[0].cgpa;
    expect(before).toBeUndefined();
    expect((resume.education as Array<Record<string, string>>)[0].cgpa).toBe(profile.user_profile.education![0].cgpa);
  });

  it.each(EARLY)("%s (early career): the summary has 3 sentences, at most 90 words, and names real evidence", (id) => {
    const { profile, resume, cap } = replay(id);
    const summary = resume.summary ?? "";
    expect(sentences(summary).length).toBeGreaterThanOrEqual(3);
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(90);
    // The captured summary's own sentences are all still there.
    for (const sn of sentences(cap.final_resume.summary ?? "")) expect(summary).toContain(sn);
    // It names one of the candidate's own projects or employers.
    const up = profile.user_profile;
    const named = [...(up.projects ?? []).map((p) => p.name), ...(up.experience ?? []).map((e) => e.company)];
    expect(named.some((n) => summary.includes(n))).toBe(true);
    // Every number in it is the candidate's.
    const allowed = extractNumbers(JSON.stringify(up));
    for (const n of extractNumbers(summary)) expect(allowed.has(n)).toBe(true);
  });

  it.each(["S06", "S07", "S08", "S09", "S10", "S11"])("%s (experienced): the summary is not enriched", (id) => {
    const { resume, cap, warnings } = replay(id);
    expect(resume.summary).toBe(cap.final_resume.summary);
    expect(warnings).not.toContain("enriched_early_career_summary");
  });

  it("S04/S05 (intern): the internship follows education instead of trailing after skills", () => {
    for (const id of ["S04", "S05"]) {
      const order = replay(id).resume.section_order as string[];
      expect(order.indexOf("experience")).toBe(order.indexOf("education") + 1);
    }
  });
});

// ── Headline ───────────────────────────────────────────────────────────────

describe("buildHeadline", () => {
  const A = profileOf("A").user_profile;
  const C = profileOf("C").user_profile;

  it("a fresher is their degree, as graduate or student, then their listed skills", () => {
    const facts = computeFacts(A, NOW);
    expect(buildHeadline({ skills: ["Java", "Spring Boot", "SQL", "MySQL", "Docker"] }, A, facts))
      .toBe("B.Tech Computer Science and Engineering Graduate | Java, Spring Boot, SQL, Docker");
    const student = computeFacts(A, new Date("2024-06-01T00:00:00Z"));
    expect(buildHeadline({ skills: ["Java"] }, A, student)).toBe("B.Tech Computer Science and Engineering Student | Java");
  });

  it("an experienced candidate is their own current title — never the target title", () => {
    const facts = computeFacts(C, NOW);
    const h = buildHeadline({ skills: ["Java", "Spring Boot"], tailored_role: "Software Development Engineer II" }, C, facts);
    expect(h.startsWith(`${facts.current_title} |`)).toBe(true);
    expect(h).not.toMatch(/Development Engineer II/);
  });

  it("tools lead; practices such as Code Review or Algorithms come last", () => {
    const facts = computeFacts(C, NOW);
    const h = buildHeadline({ skills: ["Code Review", "Algorithms", "Java", "Spring Boot", "MySQL"] }, C, facts);
    expect(h).toBe(`${facts.current_title} | Java, Spring Boot, MySQL, Code Review`);
  });

  it("uses only skills the pipeline kept: an unevidenced skill the model listed never reaches it", () => {
    const facts = computeFacts(A, NOW);
    const out = postProcessResume(
      { summary: facts.identity, skills: ["Kubernetes", "Java", "Spring Boot"], ats_score: 50, tailored_role: "SDE" },
      A, { now: NOW }
    ).resume as GeneratedResume;
    expect(out.headline).toBe("B.Tech Computer Science and Engineering Graduate | Java, Spring Boot");
  });

  it("is plain ASCII", () => {
    for (const id of scenarios.map((s) => s.id)) expect(replay(id).resume.headline).toMatch(/^[\x20-\x7E]+$/);
  });
});

// ── Summary enrichment ────────────────────────────────────────────────────

describe("enrichEarlyCareerSummary", () => {
  const A = profileOf("A").user_profile;
  const B = profileOf("B").user_profile;
  const factsA = computeFacts(A, NOW);

  it("adds nothing when the summary already has three sentences", () => {
    const summary = "B.Tech graduate. Built PaySplit. Seeking the SDE role.";
    const out = enrichEarlyCareerSummary({ summary, projects: A.projects }, A, factsA);
    expect(out.resume.summary).toBe(summary);
  });

  it("never names a project tech the pipeline would not keep", () => {
    const out = postProcessResume(
      {
        summary: "B.Tech Computer Science and Engineering graduate (2025). Seeking a Software Engineer role.",
        projects: [{ name: A.projects![0].name, description: A.projects![0].description, tech: ["Kubernetes", "Java"] }],
        skills: ["Java"], ats_score: 50, tailored_role: "Software Engineer",
      },
      A, { now: NOW }
    ).resume as GeneratedResume;
    expect(out.summary).toMatch(/Built PaySplit - Group Expense Settlement/);
    expect(out.summary).not.toMatch(/Kubernetes/);
  });

  it("names the candidate's own internship title and employer, verbatim", () => {
    const facts = computeFacts(B, NOW);
    const out = enrichEarlyCareerSummary({ summary: facts.identity, projects: [] }, B, facts);
    expect(out.resume.summary).toContain("Worked as Backend Developer Intern at Kestrel Commerce Pvt Ltd.");
  });

  it("does nothing for a candidate with a year or more of professional experience", () => {
    const C = profileOf("C").user_profile;
    const facts = computeFacts(C, NOW);
    expect(isEarlyCareer(facts)).toBe(false);
    const out = enrichEarlyCareerSummary({ summary: "Short.", projects: C.projects }, C, facts);
    expect(out.resume.summary).toBe("Short.");
  });
});

// ── Source coverage: sharper, never thinner ─────────────────────────────────

describe("enforceSourceCoverage", () => {
  const A = profileOf("A").user_profile;
  const B = profileOf("B").user_profile;
  const C = profileOf("C").user_profile;

  it("a project rewrite that drops a number the source gives is reverted to the source", () => {
    const src = A.projects![0];
    const out = enforceSourceCoverage(
      { projects: [{ ...src, description: "Built a Spring Boot REST API and React TypeScript frontend. Wrote JUnit tests and containerised the app with Docker." }] },
      A, computeFacts(A, NOW)
    );
    expect(out.resume.projects![0].description).toBe(src.description);
    expect(out.warnings.join()).toMatch(/lost_fact:40/);
  });

  it("a project rewrite that drops a named tool not in its tech line is reverted", () => {
    const src = A.projects![1];
    const out = enforceSourceCoverage(
      { projects: [{ name: src.name, tech: ["Java"], description: "Built a service for booking study rooms; piloted for 2 weeks with 120 students and removed double bookings." }] },
      A, computeFacts(A, NOW)
    );
    expect(out.resume.projects![0].description).toBe(src.description);
  });

  it("a sharper project rewrite that keeps every number and tool stands", () => {
    const src = A.projects![0];
    const sharper = "Built a Spring Boot REST API and React TypeScript frontend to split shared expenses. Integrated Razorpay test-mode payments with webhooks for created, captured and refunded states. Wrote 40 JUnit tests and containerised it with Docker.";
    const out = enforceSourceCoverage({ projects: [{ ...src, description: sharper }] }, A, computeFacts(A, NOW));
    expect(out.resume.projects![0].description).toBe(sharper);
  });

  it("an internship bullet that loses its metric is reverted; an omitted internship bullet is restored", () => {
    const src = B.experience![0];
    const out = enforceSourceCoverage(
      { experience: [{ ...src, bullets: ["Built 6 Spring Boot REST endpoints for the order-returns module backed by MySQL.", "Wrote JUnit tests for the returns service, raising module coverage."] }] },
      B, computeFacts(B, NOW)
    );
    const bullets = out.resume.experience![0].bullets!;
    expect(bullets).toContain("Built 6 Spring Boot REST endpoints for the order-returns module backed by MySQL.");
    expect(bullets).toContain(src.bullets[1]);
    expect(bullets).toContain(src.bullets[2]);
    expect(bullets).toHaveLength(3);
  });

  it("an experienced candidate's tailoring may leave a bullet out, but not lose a number from one it keeps", () => {
    const src = C.experience![0];
    const withNumber = src.bullets.find((b) => extractNumbers(b).size > 0)!;
    const stripped = withNumber.replace(/\d+(?:\.\d+)?%?/g, "").replace(/\s{2,}/g, " ");
    const out = enforceSourceCoverage({ experience: [{ ...src, bullets: [stripped] }] }, C, computeFacts(C, NOW));
    expect(out.resume.experience![0].bullets).toEqual([withNumber]);
  });

  it("an early-career candidate's project the model left out is restored, verbatim", () => {
    const out = enforceSourceCoverage(
      { projects: [A.projects![0]], section_order: ["summary", "education", "projects", "skills"] },
      A, computeFacts(A, NOW)
    );
    expect(out.resume.projects!.map((p) => p.name)).toEqual(A.projects!.map((p) => p.name));
    expect(out.resume.projects![1]).toEqual(A.projects![1]);
  });
});

describe("CGPA and location on education", () => {
  const A = profileOf("A").user_profile as GenerationProfile;
  const noGrade = { ...A, education: A.education!.map((e) => ({ ...e, cgpa: undefined })) };

  it("a CGPA the profile does not state is removed", () => {
    const edu = { ...noGrade.education![0], gpa: "9.4" };
    const out = sanitiseGeneratedResume({ education: [edu] }, noGrade as never).resume;
    expect(out.education![0]).not.toHaveProperty("gpa");
    expect(out.education![0]).not.toHaveProperty("cgpa");
  });

  it("a changed CGPA shows the candidate's own", () => {
    const out = sanitiseGeneratedResume({ education: [{ ...A.education![0], cgpa: "9.4" } as never] }, A as never).resume;
    expect((out.education![0] as Record<string, string>).cgpa).toBe("8.1");
  });

  it("formats a bare grade point as CGPA and leaves a percentage as written", () => {
    expect(formatGrade("8.1")).toBe("CGPA 8.1");
    expect(formatGrade("78%")).toBe("78%");
    expect(formatGrade("CGPA 8.1/10")).toBe("CGPA 8.1/10");
    expect(formatGrade("")).toBe("");
  });
});

it("an older stored resume's unverified model 'gpa' is never drawn", async () => {
  const rj = { ...SPARSE, education: [{ ...SPARSE.education![0], cgpa: undefined, gpa: "9.9" } as never] };
  const out = await layoutResumePdf(rj, SPARSE_CONTACT, "classic");
  expect(out.drawn.map((t) => t.text).join(" ")).not.toMatch(/9\.9/);
});

describe("orderEarlyCareerSections", () => {
  it("leaves an experienced candidate's order alone", () => {
    const C = profileOf("C").user_profile;
    const r = { section_order: ["summary", "experience", "skills", "education"], experience: C.experience };
    expect(orderEarlyCareerSections(r, computeFacts(C, NOW))).toBe(r);
  });
});

// ── PDF: one page, complete, consistent ─────────────────────────────────────

const PAGE_W = 595;
const MARGINS: Record<string, number> = { classic: 50, modern: 50, compact: 40, executive: 54 };
const roleText = (drawn: DrawnText[], role: DrawnText["role"]) => drawn.filter((d) => d.role === role).map((d) => d.text).join(" ");

/** A minimal fresher: one degree, one project, a few skills — the sparsest real profile. */
const SPARSE: ResumeJson = {
  headline: "B.Sc Computer Science Graduate | Python, SQL",
  summary: "B.Sc Computer Science graduate (2026). Built Attendance Tracker with Python and SQL. Seeking a Data Analyst role.",
  education: [{ institution: "St. Joseph's College (Autonomous), Tiruchirappalli", degree: "B.Sc Computer Science", year: "2023 - 2026", location: "Tiruchirappalli", cgpa: "8.4" }],
  projects: [{ name: "Attendance Tracker", description: "Python and SQL app that records daily class attendance.", tech: ["Python", "SQL"] }],
  skills: ["Python", "SQL", "Excel"],
  section_order: ["summary", "education", "projects", "skills"],
};
const SPARSE_CONTACT = { full_name: "Meera Iyer-Nair", email: "meera.in@example.com", phone: "+91 98400 12345", current_city: "Tiruchirappalli" };

describe("PDF layout", () => {
  const cases = [
    ...["S01", "S04", "S07", "S10"].map((id) => {
      const r = replay(id);
      return { name: id, rj: asDownloaded(r.resume), contact: contactOf(r.profile) };
    }),
    { name: "sparse", rj: SPARSE, contact: SPARSE_CONTACT },
  ];

  describe.each(TEMPLATES)("%s", (template) => {
    it.each(cases.map((c) => c.name))("%s: one page, nothing lost, contact and institution verbatim", async (name) => {
      const { rj, contact } = cases.find((c) => c.name === name)!;
      const out = await layoutResumePdf(rj, contact, template);
      expect(out.pages).toBe(1);
      const d = out.drawn;
      expect(roleText(d, "name")).toBe(contact.full_name);
      const contactLine = roleText(d, "contact");
      for (const v of [contact.email, contact.phone, contact.current_city]) expect(contactLine).toContain(v);
      const meta = roleText(d, "meta");
      for (const e of rj.education ?? []) {
        expect(meta).toContain(e.institution);
        if (e.cgpa) expect(meta).toContain(e.cgpa);
      }
      for (const e of rj.experience ?? []) expect(meta).toContain(e.company);
      if (rj.headline) expect(roleText(d, "headline")).toBe(rj.headline);
      // Every bullet and every project sentence is on the page, word for word.
      const bullets = roleText(d, "bullet");
      for (const e of rj.experience ?? []) for (const b of e.bullets) expect(bullets).toContain(b.trim());
      for (const p of rj.projects ?? []) for (const sn of descriptionBullets(p.description)) expect(bullets).toContain(sn);
      expect(roleText(d, "body")).toContain((rj.summary ?? "").trim().split(" ").slice(0, 6).join(" "));
      // Everything sits inside the margins.
      for (const t of d) {
        expect(t.x).toBeGreaterThanOrEqual(MARGINS[template] - 0.01);
        expect(t.x).toBeLessThan(PAGE_W - MARGINS[template]);
        expect(t.y).toBeGreaterThanOrEqual(MARGINS[template] - 0.01);
      }
    });

    it("keeps one hierarchy: name > section heading > entry title >= bullet, meta below title", async () => {
      const { rj, contact } = cases[1];
      const d = (await layoutResumePdf(rj, contact, template)).drawn;
      const size = (role: DrawnText["role"]) => [...new Set(d.filter((t) => t.role === role).map((t) => t.size))];
      for (const role of ["name", "section", "title", "meta", "bullet", "headline"] as const) expect(size(role)).toHaveLength(role === "meta" ? size("meta").length : 1);
      const [name] = size("name"), [section] = size("section"), [title] = size("title"), [bullet] = size("bullet");
      expect(name).toBeGreaterThan(section);
      expect(section).toBeGreaterThanOrEqual(title);
      expect(title).toBeGreaterThanOrEqual(bullet);
      expect(Math.max(...size("meta"))).toBeLessThan(title);
      expect(d.filter((t) => t.role === "section" || t.role === "title" || t.role === "name").every((t) => t.bold)).toBe(true);
      expect(d.filter((t) => t.role === "section").map((t) => t.text)).toEqual(
        (rj.section_order ?? []).map((s) => s.toUpperCase())
      );
    });

    it("a sparse page is spread to look complete, without adding any text", async () => {
      const out = await layoutResumePdf(SPARSE, SPARSE_CONTACT, template);
      expect(out.fit.space).toBeGreaterThan(1);
      expect(out.fill).toBeGreaterThan(template === "compact" ? 0.45 : 0.55);
      expect(out.fill).toBeLessThanOrEqual(0.95);
      const words = new Set(out.drawn.flatMap((t) => t.text.split(/\s+/)));
      const source = JSON.stringify({ SPARSE, SPARSE_CONTACT });
      for (const w of words) if (!/^(?:CGPA|SUMMARY|EDUCATION|PROJECTS|SKILLS|·|\|)$/.test(w)) expect(source).toContain(w);
    });

    it("a resume that just spills onto a second page is tightened back to one", async () => {
      const base = cases[3].rj; // S07, experienced
      let found = false;
      for (let extra = 1; extra <= 40 && !found; extra++) {
        const rj: ResumeJson = {
          ...base,
          experience: base.experience!.map((e, i) =>
            i === 0 ? { ...e, bullets: [...e.bullets, ...Array.from({ length: extra }, (_, k) => `Delivered extra piece of documented work number ${k} for the platform team.`)] } : e
          ),
        };
        const out = await layoutResumePdf(rj, cases[3].contact, template);
        if (out.fit.space < 1) {
          expect(out.pages).toBe(1);
          found = true;
        }
      }
      expect(found).toBe(true);
    });
  });

  it("text is WinAnsi-safe after the download route's scrub (no glyph the standard fonts cannot draw)", async () => {
    const r = replay("S01");
    const out = await layoutResumePdf(asDownloaded(r.resume), contactOf(r.profile), "classic");
    for (const t of out.drawn) expect(t.text).toMatch(/^[\x20-\xFF]*$/);
  });
});

describe("no JD-only skill anywhere on an early-career page", () => {
  it.each(EARLY)("%s", async (id) => {
    const { resume, profile } = replay(id);
    const evidence = new Set(detectTechSkills(JSON.stringify({ ...profile.user_profile, summary: "" })));
    const out = await layoutResumePdf(asDownloaded(resume), contactOf(profile), "modern");
    const page = out.drawn.map((t) => t.text).join(" ");
    for (const k of detectTechSkills(page.replace(/Seeking[^.]*\./g, ""))) expect({ id, k, evidenced: evidence.has(k) }).toEqual({ id, k, evidenced: true });
  });
});
