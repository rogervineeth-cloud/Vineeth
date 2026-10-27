/**
 * Production QA, 27 Oct 2026 (main 1f55cdb, synthetic QA account, three real
 * generations). Each defect is reproduced from the shapes QA reported, then
 * pinned:
 *
 *  1. missing_keywords told a junior PM "User Stories", "Product
 *     Specification" and "Stakeholder Communication" were missing although
 *     the profile says "wrote user stories", "owned product spec" and lists
 *     Stakeholder Communication.
 *  2. growth_note stated the role "requires 2-3 years" — absent from the JD.
 *  3. summaries ended "... and collaborated." after an unsupported "with ..."
 *     was trimmed off.
 *  4. the free ATS review's CTA still said "free in beta".
 *  5. preview: right after an unlock, the download was blocked by a second,
 *     unconditional canDownload guard reading the pre-unlock closure.
 *  6. the opt-in stepper browser suite ran `npm root -g` at collection time
 *     even with E2E off.
 */
import * as fs from "fs";
import * as path from "path";
import {
  enforceSkillEvidence, enforceAdviceEvidence, enforceSummaryFacts, phraseEvidenced, requirementYears,
  type GenerationProfile,
} from "@/lib/resume-generation";
import { computeFacts } from "@/lib/profile-facts";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
type Resume = Parameters<typeof enforceSkillEvidence>[0];

/** The junior PM profile QA used (fictional). */
const PM: GenerationProfile = {
  summary: "Product analyst eager to learn user research and roadmapping.",
  skills: ["Product Management", "Stakeholder Communication", "SQL", "Jira"],
  target_roles: ["Associate Product Manager"],
  experience: [{
    company: "Finlo", role: "Product Analyst", duration: "Jan 2025 - Present", location: "Bengaluru",
    bullets: [
      "Wrote user stories for the onboarding revamp used by 40,000 users.",
      "Owned product spec for the KYC flow and shipped it in 6 weeks.",
    ],
  }],
  education: [{ institution: "IIT Madras", degree: "B.Tech", year: "2024", location: "Chennai" }],
  projects: [],
};
const FACTS = computeFacts(PM, new Date("2026-10-27T00:00:00Z"));

describe("1. missing_keywords never lists a practice the profile's own words show", () => {
  it("drops User Stories, Product Specification and Stakeholder Communication; keeps real gaps", () => {
    const { resume, warnings } = enforceSkillEvidence(
      { missing_keywords: ["User Stories", "Product Specification", "Stakeholder Communication", "A/B Testing", "Roadmapping"] } as Resume,
      PM,
    );
    expect(resume.missing_keywords).toEqual(["A/B Testing", "Roadmapping"]);
    expect(warnings).toEqual(expect.arrayContaining([
      "dropped_evidenced_missing_keyword:User Stories",
      "dropped_evidenced_missing_keyword:Product Specification",
      "dropped_evidenced_missing_keyword:Stakeholder Communication",
    ]));
  });

  it("matching is phrase-level, in order and close together — not loose word overlap", () => {
    expect(phraseEvidenced("User Stories", PM)).toBe(true);
    expect(phraseEvidenced("user story", PM)).toBe(true);
    expect(phraseEvidenced("Product Specs", PM)).toBe(true);
    expect(phraseEvidenced("Stories User", PM)).toBe(false);          // order matters
    expect(phraseEvidenced("Product Analytics", PM)).toBe(false);     // "Product Analyst" is not analytics
    expect(phraseEvidenced("User Research", PM)).toBe(false);         // only in the summary (aspiration)
    expect(phraseEvidenced("Roadmapping", PM)).toBe(false);
    expect(phraseEvidenced("", PM)).toBe(false);
  });
});

describe("2. growth_note may state only role requirements the JD states", () => {
  const NOTE = "This role typically requires 2-3 years of product management experience. Gaining hands-on A/B testing experience would strengthen your application.";
  const advise = (jd?: string) => enforceAdviceEvidence({ growth_note: NOTE, missing_keywords: ["A/B Testing"] } as Resume, PM, FACTS, jd);

  it("a tenure the JD never states is dropped; the rest of the note stays", () => {
    const { resume, warnings } = advise("Associate Product Manager. Own user stories and specs. Work with design and engineering.");
    expect(resume.growth_note).toBe("Gaining hands-on A/B testing experience would strengthen your application.");
    expect(warnings).toContain("dropped_growth_note_sentence:role_years_not_in_jd:2-3 years");
  });

  it.each([
    "Requires 2-3 years of experience in product roles.",
    "2 to 3 yrs of PM experience preferred.",
    "Two to three years of experience.",
  ])("kept when the JD states it: %p", (jd) => {
    expect(advise(jd).resume.growth_note).toBe(NOTE);
  });

  it("without JD text (older callers) nothing changes", () => {
    expect(advise(undefined).resume.growth_note).toBe(NOTE);
  });

  it("the candidate's own years are still checked against their facts, not the JD", () => {
    const own = enforceAdviceEvidence({ growth_note: "Your 1 year as a Product Analyst is a solid base." } as Resume, PM, FACTS, "No tenure stated.");
    expect(own.resume.growth_note).toBe("Your 1 year as a Product Analyst is a solid base.");
  });

  it("requirementYears reads digits, ranges, plus-forms and number words", () => {
    expect([...requirementYears("3+ years; 2-3 yrs; two years; 5 to 7 years")].sort()).toEqual(["2", "3", "5", "7"]);
  });

  it("the route passes the JD text into post-processing", () => {
    expect(read("app/api/generate-resume/route.ts")).toMatch(/postProcessResume\(parsedReply\.json, parsed\.data\.user_profile, \{ jdText: parsed\.data\.jd_text \}\)/);
  });
});

describe("3. a trimmed summary never ends on a bare coordinated verb", () => {
  it.each([
    ["Product Analyst at Finlo who wrote user stories and collaborated with Apple's hardware engineering teams.", "Product Analyst at Finlo who wrote user stories."],
    ["Product Analyst who owned the KYC product spec and collaborated with cross-functional design and data science partners.", "Product Analyst who owned the KYC product spec."],
  ])("%p", (summary, expected) => {
    const out = enforceSummaryFacts({ summary } as Resume, PM, FACTS).resume.summary as string;
    expect(out).toBe(expected);
    expect(out).not.toMatch(/\band\s+[a-z]+ed\.$/i);
  });
});

describe("4. the free ATS review's CTA follows the credit rules", () => {
  const src = read("app/free-review/FreeReviewClient.tsx");
  it("no 'free in beta'; the CTA states the free view-only preview rule", () => {
    expect(src).not.toMatch(/free in beta/i);
    expect(src).toMatch(/import \{ FREE_PREVIEW_RULE \} from "@\/lib\/plan-config";/);
    expect(src).toMatch(/Want an AI-tailored resume for this JD\? \{FREE_PREVIEW_RULE\}/);
    expect(src).toMatch(/<Link href="\/create">Generate a tailored resume →<\/Link>/);
  });
});

describe("5. preview: the download right after an unlock is not blocked by a stale closure", () => {
  const src = read("app/(app)/preview/[id]/page.tsx");
  const body = src.slice(src.indexOf("async function handleDownload("), src.indexOf("setDownloading(true);", src.indexOf("async function handleDownload(")));
  it("one guard, which lets the post-unlock call through", () => {
    expect(body.match(/if \(!canDownload/g)).toHaveLength(1);
    expect(body).toMatch(/if \(!canDownload && !justUnlocked\) \{ toast\.error\(NOT_DOWNLOADABLE\); return; \}/);
    expect(src).toMatch(/setAction\("download"\);[\s\S]{0,200}await handleDownload\(true\);/);
  });
});

describe("6. the opt-in browser suite costs nothing when E2E is off", () => {
  const src = read("__tests__/stepper-create-navigation.test.ts");
  it("Playwright is located lazily, inside the browser helper", () => {
    expect(src).toMatch(/const loadChromium = \(\) => require\(path\.join\(execSync\("npm root -g"\)/);
    expect(src).toMatch(/await loadChromium\(\)\.launch\(/);
    expect(src).not.toMatch(/^\s*const \{ chromium \} = require/m);
  });
});
