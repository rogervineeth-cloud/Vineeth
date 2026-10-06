// Resume styles the user can pick on /create and when downloading. Safe to
// import from client and server components.
//
// Every style is the same single-column, text-only ATS layout
// (lib/resume-pdf.ts); they differ in colour, type scale and spacing only.
// "executive" was offered before and is no longer: resumes saved with it
// still render in it (lib/resume-pdf.ts resolveTemplate), but it cannot be
// picked for a new resume or a download.

export const TEMPLATE_IDS = ["classic", "modern", "compact"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** The accessible default: black on white, the most conservative style. */
export const DEFAULT_TEMPLATE: TemplateId = "classic";

export const TEMPLATE_STYLES: Record<TemplateId, { label: string; description: string }> = {
  classic: { label: "Classic", description: "Black and charcoal, highest contrast" },
  modern: { label: "Modern", description: "Navy name, restrained green headings" },
  compact: { label: "Compact", description: "Tighter spacing for longer experience" },
};

/** localStorage key the create page and the stepper share. */
export const TEMPLATE_STORAGE_KEY = "ndrs_template";

export const isTemplateId = (v: unknown): v is TemplateId =>
  typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);

/**
 * The template to start with from what localStorage holds. The create page
 * wrote the choice here but always started from "classic", so a template
 * picked at step 7 reverted on the next visit and Review showed Classic.
 * Anything missing, unknown or retired falls back to "classic".
 */
export function storedTemplate(raw: string | null | undefined): TemplateId {
  return isTemplateId(raw) ? raw : DEFAULT_TEMPLATE;
}

/**
 * The style a download renders in: an offered style the user asked for
 * (?style=), otherwise whatever the resume was saved with — which keeps a
 * saved resume, including a retired "executive" one, looking exactly as it
 * did. Never written back to the resume.
 */
export function downloadStyle(requested: string | null | undefined, saved: string | null | undefined): string | null {
  return isTemplateId(requested) ? requested : saved ?? null;
}
