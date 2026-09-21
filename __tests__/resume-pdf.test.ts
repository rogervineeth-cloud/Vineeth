// Resume PDF renderer.
//
// Three regressions this guards against, all of which shipped:
//   1. section_order was ignored — freshers got an experienced person's layout
//      even though the generator explicitly asked for education/projects first.
//   2. Exactly one page was ever created, so a long resume drew past the
//      bottom margin and the overflow silently vanished.
//   3. All four templates produced a byte-identical PDF.
import {
  renderResumePdf,
  resolveTemplate,
  resolveSectionOrder,
  type ResumeJson,
} from "@/lib/resume-pdf";

const CONTACT = {
  full_name: "Priya Sharma",
  email: "priya@example.com",
  phone: "+91 98765 43210",
  current_city: "Bengaluru",
};

const BASE: ResumeJson = {
  summary: "Backend engineer with 3 years building Node.js services on AWS.",
  experience: [
    {
      company: "Acme Logistics",
      role: "Backend Engineer",
      duration: "Jun 2022 - Present",
      location: "Bengaluru",
      bullets: ["Led migration of the order pipeline to AWS Lambda."],
    },
  ],
  skills: ["TypeScript", "Node.js", "AWS"],
  education: [
    { institution: "IIT Madras", degree: "B.Tech CSE", year: "2022", location: "Chennai" },
  ],
  projects: [{ name: "Report Bot", description: "Automated reporting.", tech: ["Python"] }],
  tailored_role: "Backend Engineer",
};

describe("resolveTemplate", () => {
  it.each(["classic", "modern", "compact", "executive"])("passes through %s", (id) => {
    expect(resolveTemplate(id)).toBe(id);
  });

  it.each([null, undefined, "", "nonsense", "two-column"])(
    "falls back to classic for %s",
    (id) => expect(resolveTemplate(id as string | null)).toBe("classic")
  );
});

describe("resolveSectionOrder", () => {
  it("honours the generator's fresher ordering", () => {
    const order = resolveSectionOrder({
      ...BASE,
      section_order: ["summary", "education", "projects", "skills", "experience"],
    });
    expect(order.indexOf("education")).toBeLessThan(order.indexOf("experience"));
    expect(order.indexOf("projects")).toBeLessThan(order.indexOf("experience"));
  });

  it("falls back to the experienced ordering when none is given", () => {
    expect(resolveSectionOrder(BASE)).toEqual([
      "summary", "experience", "skills", "education", "projects",
    ]);
  });

  it("never drops a section the generator forgot to list", () => {
    const order = resolveSectionOrder({ ...BASE, section_order: ["summary"] });
    for (const s of ["summary", "experience", "skills", "education", "projects"]) {
      expect(order).toContain(s);
    }
    expect(order[0]).toBe("summary");
  });

  it("ignores unknown section names rather than crashing", () => {
    const order = resolveSectionOrder({ ...BASE, section_order: ["hobbies", "summary"] });
    expect(order).not.toContain("hobbies");
    expect(order).toContain("summary");
  });

  it("produces no duplicates", () => {
    const order = resolveSectionOrder({
      ...BASE,
      section_order: ["summary", "summary", "experience"],
    });
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("renderResumePdf", () => {
  it("produces a valid PDF", async () => {
    const bytes = await renderResumePdf(BASE, CONTACT, "classic");
    expect(bytes.length).toBeGreaterThan(500);
    // %PDF- magic number
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("renders every template, and they differ from one another", async () => {
    const ids = ["classic", "modern", "compact", "executive"] as const;
    const sizes = await Promise.all(
      ids.map(async (id) => Buffer.from(await renderResumePdf(BASE, CONTACT, id)).toString("base64"))
    );
    // Previously all four were byte-identical because template was ignored.
    expect(new Set(sizes).size).toBe(ids.length);
  });

  it("adds pages instead of losing content when the resume is long", async () => {
    const long: ResumeJson = {
      ...BASE,
      experience: Array.from({ length: 12 }, (_, i) => ({
        company: `Company ${i}`,
        role: "Senior Engineer",
        duration: "Jan 2015 - Dec 2020",
        location: "Bengaluru",
        bullets: Array.from({ length: 6 }, (_, b) =>
          `Delivered a substantial piece of work number ${b} that needs enough words to wrap onto more than a single rendered line in the output document.`
        ),
      })),
    };

    const onePage = await renderResumePdf(BASE, CONTACT, "classic");
    const manyPages = await renderResumePdf(long, CONTACT, "classic");

    // A far longer resume must produce a materially larger document, which
    // only happens if extra pages were added rather than text being drawn
    // off the bottom of a single sheet.
    expect(manyPages.length).toBeGreaterThan(onePage.length * 2);
  });

  it("does not throw on an empty resume", async () => {
    await expect(renderResumePdf({}, {}, null)).resolves.toBeDefined();
  });

  it("does not throw when contact details are missing", async () => {
    const bytes = await renderResumePdf(BASE, {}, "modern");
    expect(bytes.length).toBeGreaterThan(500);
  });
});
