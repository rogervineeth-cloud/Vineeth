// Resume templates the user can pick on /create. Safe to import from client
// and server components.

export const TEMPLATE_IDS = ["classic", "modern", "compact", "executive"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** localStorage key the create page and the stepper share. */
export const TEMPLATE_STORAGE_KEY = "ndrs_template";

/**
 * The template to start with from what localStorage holds. The create page
 * wrote the choice here but always started from "classic", so a template
 * picked at step 7 reverted on the next visit and Review showed Classic.
 * Anything missing or unknown falls back to "classic".
 */
export function storedTemplate(raw: string | null | undefined): TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(raw ?? "") ? (raw as TemplateId) : "classic";
}
