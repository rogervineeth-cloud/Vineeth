// Anti-hallucination validator.
//
// The fabricated values below are taken verbatim from the 21 Sep functional
// test report — they are things the model actually produced and shipped into
// a finished resume.
import {
  sanitiseGeneratedResume,
  extractNumbers,
  unverifiableNumbers,
  profileNumbers,
  type SanitiseProfile,
  type ResumeShape,
} from "@/lib/sanitise-resume";

const PROFILE: SanitiseProfile = {
  summary: "Backend engineer with 3 years of experience.",
  experience: [
    {
      company: "Acme Logistics",
      role: "Backend Engineer",
      duration: "Jun 2022 - Present",
      bullets: ["Cut infra cost by 38% after migrating the order pipeline."],
    },
  ],
  education: [
    { institution: "IIT Madras", degree: "B.Tech CSE", year: "2022" },
  ],
  projects: [{ name: "Report Bot", description: "Automated 120 reports.", tech: ["Python"] }],
  skills: ["Node.js", "AWS"],
};

describe("extractNumbers", () => {
  it("pulls numeric tokens out of prose", () => {
    expect([...extractNumbers("grew revenue by 35% to ₹8.5 Cr")].sort()).toEqual(["35", "8.5"]);
  });

  it("strips thousands separators so 1,200 matches 1200", () => {
    expect(extractNumbers("handled 1,200 tickets").has("1200")).toBe(true);
  });

  it("normalises trailing .0", () => {
    expect(extractNumbers("exactly 5.0x").has("5")).toBe(true);
  });
});

describe("profileNumbers", () => {
  it("collects numbers from every part of the profile", () => {
    const nums = profileNumbers(PROFILE);
    expect(nums.has("3")).toBe(true);    // summary
    expect(nums.has("38")).toBe(true);   // experience bullet
    expect(nums.has("2022")).toBe(true); // education year
    expect(nums.has("120")).toBe(true);  // project description
  });
});

describe("unverifiableNumbers", () => {
  it("accepts a metric the profile actually contains", () => {
    expect(unverifiableNumbers("Cut cost by 38%", profileNumbers(PROFILE))).toEqual([]);
  });

  it("flags a metric the profile never mentions", () => {
    expect(unverifiableNumbers("Improved close rates by 28%", profileNumbers(PROFILE))).toEqual(["28"]);
  });
});

describe("sanitiseGeneratedResume", () => {
  it("drops bullets asserting invented metrics, keeps grounded ones", () => {
    const resume: ResumeShape = {
      experience: [
        {
          company: "Acme Logistics",
          role: "Backend Engineer",
          duration: "Jun 2022 - Present",
          bullets: [
            "Cut infra cost by 38% after migrating the order pipeline.",
            "Drove ₹8.5 Cr in annual partner-generated revenue.",
            "Improved close rates by 28% while maintaining 94% satisfaction.",
            "Led the migration to a service-oriented architecture.",
          ],
        },
      ],
    };

    const { resume: out, warnings } = sanitiseGeneratedResume(resume, PROFILE);
    const bullets = out.experience![0].bullets!;

    expect(bullets).toContain("Cut infra cost by 38% after migrating the order pipeline.");
    // No numbers at all → nothing to verify → kept.
    expect(bullets).toContain("Led the migration to a service-oriented architecture.");
    expect(bullets).not.toContain("Drove ₹8.5 Cr in annual partner-generated revenue.");
    expect(bullets.some((b) => b.includes("28%"))).toBe(false);
    expect(warnings.some((w) => w.startsWith("dropped_bullet_unverifiable_metric"))).toBe(true);
  });

  it("drops placeholder education rows", () => {
    const resume: ResumeShape = {
      education: [
        { institution: "Institution Name", degree: "Bachelor's Degree", year: "2020" },
        { institution: "IIT Madras", degree: "B.Tech CSE", year: "2022" },
      ],
    };
    const { resume: out, warnings } = sanitiseGeneratedResume(resume, PROFILE);
    expect(out.education).toHaveLength(1);
    expect(out.education![0].institution).toBe("IIT Madras");
    expect(warnings.some((w) => w.startsWith("dropped_placeholder_institution"))).toBe(true);
  });

  it("still drops placeholder and fabricated companies", () => {
    const resume: ResumeShape = {
      experience: [
        { company: "Previous Organization", role: "Senior Sales Executive", duration: "2019 - 2021", bullets: [] },
        { company: "Never Heard Of Ltd", role: "Engineer", duration: "2019 - 2021", bullets: [] },
        { company: "Acme Logistics", role: "Backend Engineer", duration: "Jun 2022 - Present", bullets: [] },
      ],
    };
    const { resume: out, warnings } = sanitiseGeneratedResume(resume, PROFILE);
    expect(out.experience).toHaveLength(1);
    expect(out.experience![0].company).toBe("Acme Logistics");
    expect(warnings.some((w) => w.includes("Previous Organization"))).toBe(true);
    expect(warnings.some((w) => w.includes("Never Heard Of Ltd"))).toBe(true);
  });

  it("falls back to the user's own text when a project metric is invented", () => {
    const resume: ResumeShape = {
      projects: [{ name: "Report Bot", description: "Saved 900 hours and ₹4.2 Cr.", tech: ["Python"] }],
    };
    const { resume: out, warnings } = sanitiseGeneratedResume(resume, PROFILE);
    expect(out.projects![0].description).toBe("Automated 120 reports.");
    expect(warnings.some((w) => w.startsWith("stripped_project_metric"))).toBe(true);
  });

  it("caps the score and explains itself when no experience survives", () => {
    const resume: ResumeShape = {
      experience: [{ company: "Previous Organization", role: "X", duration: "2019", bullets: [] }],
      section_order: ["summary", "experience", "skills"],
      ats_score: 88,
    };
    const { resume: out } = sanitiseGeneratedResume(resume, PROFILE);
    expect(out.experience).toBeUndefined();
    expect(out.ats_score).toBe(65);
    expect(out.section_order).not.toContain("experience");
    expect(out.growth_note).toBeTruthy();
  });

  it("leaves a clean resume untouched", () => {
    const resume: ResumeShape = {
      experience: [
        {
          company: "Acme Logistics",
          role: "Backend Engineer",
          duration: "Jun 2022 - Present",
          bullets: ["Cut infra cost by 38% after migrating the order pipeline."],
        },
      ],
      education: [{ institution: "IIT Madras", degree: "B.Tech CSE", year: "2022" }],
      ats_score: 74,
    };
    const { warnings } = sanitiseGeneratedResume(resume, PROFILE);
    expect(warnings).toEqual([]);
  });
});
