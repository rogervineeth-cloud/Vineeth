// The /create flow's steps and their ?step= values. Shared by the create page
// and the global stepper so both always agree on which step is showing.
//
// Before, the page read ?step= once on mount and kept its own state. The
// stepper's links change only the URL, so clicking "Job Desc" while on
// Template highlighted Job Desc in the stepper while the page stayed on
// Template. The page now follows the URL (see useCreateStep in the page).

export type CreateStep = 1 | 2 | 3 | 4;

export const CREATE_STEP_PARAM: Record<CreateStep, string> = { 1: "jd", 2: "template", 3: "review", 4: "resume" };

/** The step a ?step= value shows. Missing or unknown → the job description step. */
export function createStepFromParam(step: string | null | undefined): CreateStep {
  if (step === "template") return 2;
  if (step === "review") return 3;
  if (step === "resume") return 4;
  return 1;
}

/**
 * A /create link for a step that keeps the rest of the current query — in
 * particular ?regen=<id>, without which a regeneration reached through the
 * stepper would lose its parent (no lineage, and charged instead of free).
 */
export function createStepHref(currentSearch: string, step: CreateStep): string {
  const params = new URLSearchParams(currentSearch);
  if (step === 1) params.delete("step");
  else params.set("step", CREATE_STEP_PARAM[step]);
  const qs = params.toString();
  return qs ? `/create?${qs}` : "/create";
}

/** The parts of a click event that decide whether to handle it in-page. */
export type StepClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

/**
 * Whether a click on a stepper link to another /create step should be handled
 * in-page. Only a plain left click on /create; modified clicks (new tab or
 * window) keep the browser's default.
 *
 * Why in-page: after a direct load of /create?step=template (a reload or a
 * pasted URL), a Next <Link> to the Job Desc step did nothing: no request, no
 * history entry, the page stayed on Template (reproduced in Chromium with both
 * a real and a programmatic click). A shallow history.pushState — what the
 * page's own step buttons use, and which Next's router picks up for
 * useSearchParams — switches the step reliably, and the page follows ?step=.
 */
export function handleStepClickInPage(e: StepClick, currentPathname: string): boolean {
  return (
    currentPathname.startsWith("/create") &&
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}
