/**
 * Regressions from the final live verification of 2bfe4be (final-live-4,
 * 2026-09-25). Each test replays the captured RAW model reply through today's
 * postProcessResume; the as-captured output (previous code) is shown to fail
 * the same check.
 */
import * as fs from "fs";
import * as path from "path";
import { postProcessResume, keepsSummaryFraming } from "@/lib/resume-generation";
import { Evidence, novelDetail, trimToEvidence, LIST_FRAGMENT } from "@/lib/detail-evidence";
import { computeFacts } from "@/lib/profile-facts";
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
  const cap = read<{ raw_resume: GeneratedResume; final_resume: GeneratedResume }>(`captured/live-final-4/${id}.json`);
  const replayed = postProcessResume(structuredClone(cap.raw_resume), profile.user_profile, { now: NOW }).resume as GeneratedResume;
  return { s, profile, jd, cap, replayed };
}
const gate = (r: ReturnType<typeof evaluateResume>, g: string) => r.gates.find((x) => x.gate === g)!;

describe("S09: a clause cut never leaves a list fragment", () => {
  it("as captured, the summary ended in a dangling list and the evaluator now fails it", () => {
    const { profile, jd, s, cap } = load("S09");
    expect(cap.final_resume.summary).toMatch(/Google Cloud, C\+\+, and test automation\./);
    expect(gate(evaluateResume(profile, jd, s, cap.final_resume, NOW), "summary_framing").defects.join()).toMatch(/dangling list after the role/);
  });

  it("replayed: a complete target-role statement", () => {
    const { profile, jd, s, replayed } = load("S09");
    // Since final-live-5 the evidenced domain ("embedded systems" for "embedded devices") is kept too.
    expect(replayed.summary).toBe("QA Engineer with 2+ years of professional experience in embedded systems and firmware testing. Seeking a Software Engineer II role at Google Cloud.");
    expect(gate(evaluateResume(profile, jd, s, replayed, NOW), "summary_framing").defects).toEqual([]);
  });

  it("trimToEvidence cuts a clause to the sentence end when a list continues after the next comma", () => {
    const sentence = "Seeking a Software Engineer II role at Google Cloud, bringing expertise in Python, C++, and test automation with a strong foundation in distributed systems";
    const ev = new Evidence("Seeking a Software Engineer II role at Google Cloud Python C++ test automation");
    const out = trimToEvidence(`${sentence}.`, { novel: (t) => novelDetail(t, ev, { summary: true }) });
    expect(out).toBe("Seeking a Software Engineer II role at Google Cloud.");
    expect(LIST_FRAGMENT.test(out ?? "")).toBe(false);
  });

  it("a cut that ends before a non-list clause still stops at the comma", () => {
    const src = "Automated 150 firmware regression cases with Python and pytest, cutting a regression cycle from 3 days to 1 day.";
    const ev = new Evidence(src);
    expect(trimToEvidence("Automated 150 firmware regression cases with Python and pytest, enabling faster releases, cutting a regression cycle from 3 days to 1 day.", {
      source: src, novel: (t) => novelDetail(t, ev),
    })).toBe(src);
  });

  it("keepsSummaryFraming refuses a list fragment", () => {
    expect(keepsSummaryFraming("x", "Seeking a Software Engineer II role at Google Cloud, C++, and test automation.", ["QA Engineer"])).toBe(false);
    expect(keepsSummaryFraming("x", "Seeking a Software Engineer II role at Google Cloud, with hands-on experience in REST API development.", ["QA Engineer"])).toBe(true);
  });
});

describe("S03: a role requirement ('requiring 3+ years') is not a candidate claim", () => {
  it("as captured the sentence was dropped; replayed it is kept", () => {
    const { cap, replayed } = load("S03");
    const sentence = "You are a fresher (graduating 2025) applying for a role requiring 3+ years of professional software development and 2+ years of system design experience.";
    expect(cap.final_resume.growth_note).not.toContain(sentence);
    expect(replayed.growth_note).toContain(sentence);
  });

  it("a wrong years claim about the candidate is still caught", () => {
    const C = read<ProfileFixture>("fixtures/profiles/C-experienced-backend.json").user_profile;
    const r = postProcessResume({ summary: "Backend engineer with 3 years building Java and Spring Boot microservices for payments.", growth_note: "You have 1 year of professional experience, below the 3-year requirement." }, C, { now: NOW }).resume as GeneratedResume;
    expect(r.growth_note ?? "").not.toMatch(/You have 1 year/);
    expect(computeFacts(C, NOW).professional_years).toBe(3.2);
  });
});

describe("all 11 final-live-4 captures, replayed", () => {
  it("only S03, S08 and S09 change (S08: evidenced domain kept since final-live-5)", () => {
    const changed = IDS.filter((id) => {
      const { cap, replayed } = load(id);
      return JSON.stringify(cap.final_resume) !== JSON.stringify(replayed);
    });
    expect(changed).toEqual(["S03", "S08", "S09"]);
  });

  it.each(IDS)("%s: factual, detail, framing, advice and keyword gates pass; the role is named", (id) => {
    const { profile, jd, s, replayed } = load(id);
    const ev = evaluateResume(profile, jd, s, replayed, NOW);
    for (const g of ["factual_fidelity", "detail_fidelity", "summary_framing", "advice_fidelity", "ats_keywords"]) {
      expect({ id, g, defects: gate(ev, g).defects }).toEqual({ id, g, defects: [] });
    }
    expect(replayed.summary).toMatch(/\bSeeking\b[^.]*\brole\b/i);
    expect(LIST_FRAGMENT.test(replayed.summary ?? "")).toBe(false);
  });
});
