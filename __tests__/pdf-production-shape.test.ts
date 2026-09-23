/**
 * Regression test built from the shape of a REAL production resume.
 *
 * Row 0ed43d44 (generated 2026-09-22 17:14 UTC on Haiku) measured as:
 *
 *   summary            434 chars
 *   experience         2 entries, 5 bullets, 134..209 chars (avg 164)
 *   skills             180 chars when joined with the separator
 *   education          1 entry
 *   projects           0 entries
 *   company+role line  37 chars max
 *   name / contact     14 / 60 chars
 *
 * Only the DIMENSIONS were taken; no resume content was read out of the
 * database. Synthetic text is padded to the same lengths so the layout maths
 * — wrapping, section spacing, page breaks — sees an equivalent document.
 *
 * Guards the two things that silently corrupt a real download: a resume that
 * fits being pushed onto a second page, and a resume that does not fit being
 * clipped instead of paginated.
 */
import { renderResumePdf, type ResumeJson } from "@/lib/resume-pdf";
import { PDFDocument } from "pdf-lib";

const pad = (n: number, seed: string) => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);

const CONTACT = {
  full_name: pad(14, "Namesurname "),
  email: pad(30, "user@example.com "),
  phone: "+91 98765 43210",
  current_city: "Trivandrum",
};

/** Same dimensions as production row 0ed43d44. */
const PRODUCTION_SHAPE: ResumeJson = {
  section_order: ["summary", "experience", "skills", "education", "projects"],
  summary: pad(434, "Senior engineer with a decade of delivery experience across cloud platforms. "),
  experience: [
    {
      company: pad(18, "Companyname Ltd "),
      role: pad(16, "Senior Engineer "),
      duration: "Jun 2018 - Present",
      location: "Trivandrum",
      bullets: [pad(209, "Delivered a significant platform workstream with measurable outcomes. "),
                pad(164, "Designed and shipped services used across several teams. "),
                pad(134, "Improved reliability and reduced operational toil. ")],
    },
    {
      company: pad(16, "Othercompany Ltd "),
      role: pad(18, "Software Engineer "),
      duration: "Jul 2014 - May 2018",
      location: "Bengaluru",
      bullets: [pad(180, "Built and maintained backend APIs for a large client programme. "),
                pad(150, "Automated release verification and cut manual effort. ")],
    },
  ],
  skills: Array.from({ length: 15 }, (_, i) => pad(10, `Skill${i}Name`)),
  education: [
    { institution: pad(33, "College of Engineering Somewhere "), degree: "B.Tech Computer Science", year: "2014", location: "Trivandrum" },
  ],
  projects: [],
  tailored_role: "Senior Software Engineer",
};

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe("PDF layout against a real production resume shape", () => {
  it.each(["classic", "modern", "compact", "executive"] as const)(
    "%s fits a 2-job / 5-bullet resume on a single page",
    async (template) => {
      const bytes = await renderResumePdf(PRODUCTION_SHAPE, CONTACT, template);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      // A typical 10-year resume must not spill onto page 2 — that is the
      // difference between a document a recruiter reads and one they skim.
      expect({ template, pages: await pageCount(bytes) }).toEqual({ template, pages: 1 });
    }
  );

  it("paginates rather than clipping when the same resume grows", async () => {
    const big: ResumeJson = {
      ...PRODUCTION_SHAPE,
      experience: Array.from({ length: 8 }, () => PRODUCTION_SHAPE.experience![0]),
    };
    const pages = await pageCount(await renderResumePdf(big, CONTACT, "classic"));
    expect(pages).toBeGreaterThan(1);
  });

  it("emits no literal undefined/NaN for a production-shaped document", async () => {
    const raw = Buffer.from(await renderResumePdf(PRODUCTION_SHAPE, CONTACT, "modern")).toString("latin1");
    for (const bad of ["undefined", "NaN", "[object Object]"]) {
      expect({ bad, present: raw.includes(bad) }).toEqual({ bad, present: false });
    }
  });

  it("honours the stored template rather than falling back to classic", async () => {
    const classic = await renderResumePdf(PRODUCTION_SHAPE, CONTACT, "classic");
    const modern = await renderResumePdf(PRODUCTION_SHAPE, CONTACT, "modern");
    expect(Buffer.from(modern).toString("base64")).not.toBe(Buffer.from(classic).toString("base64"));
  });

  it("renders a resume with zero projects without leaving an empty section", async () => {
    // projects: [] is the real production shape. An empty section header with
    // nothing under it looks like a bug to the candidate.
    const bytes = await renderResumePdf(PRODUCTION_SHAPE, CONTACT, "classic");
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).not.toContain("PROJECTS");
  });
});
