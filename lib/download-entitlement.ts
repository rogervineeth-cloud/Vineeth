// Whether the OWNER of a resume may download it as a PDF. Safe to import from
// client and server components: the preview page uses it to choose between
// the Download button and the upgrade modal, and /api/download-pdf enforces
// it. The caller must already have established that the resume belongs to the
// user — this function only decides entitlement, never ownership.
//
// A resume is downloadable when any of:
//   1. it has been downloaded before (re-downloads are always free);
//   2. the user has an active plan with a credit left (unchanged behaviour);
//   3. the user held a plan when the resume was created — the plan was
//      purchased at or before the resume's created_at — even if that plan is
//      now exhausted or expired.
//
// Rule 3 is the fix. Generating a resume consumes a credit; without it, the
// resume that used a plan's LAST credit (every Single purchase) could not be
// downloaded: no active plan with credits, and not yet downloaded → 402. The
// same applied to a free regeneration made after the last credit, and to any
// generated-but-not-yet-downloaded resume once the plan ran out or expired.
// "Each AI-tailored resume can be re-downloaded as a PDF unlimited times"
// (lib/plan-config.ts) — the credit buys the resume, not a time window.

export type DownloadPlan = {
  resumes_used: number | null;
  resumes_allotted: number;
  expires_at: string;
  purchased_at: string | null;
};

export type DownloadResume = {
  created_at: string;
  downloaded_at: string | null;
};

export function resumeDownloadAllowed(
  resume: DownloadResume,
  plans: readonly DownloadPlan[],
  now: Date = new Date()
): boolean {
  if (resume.downloaded_at) return true;

  const hasActiveCredit = plans.some(
    (p) => Date.parse(p.expires_at) > now.getTime() && (p.resumes_used ?? 0) < p.resumes_allotted
  );
  if (hasActiveCredit) return true;

  const createdAt = Date.parse(resume.created_at);
  if (Number.isNaN(createdAt)) return false;
  return plans.some((p) => {
    const purchasedAt = p.purchased_at ? Date.parse(p.purchased_at) : NaN;
    return !Number.isNaN(purchasedAt) && purchasedAt <= createdAt;
  });
}
