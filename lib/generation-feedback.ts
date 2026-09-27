// How the create page presents /api/generate-resume answers that are not a
// finished resume. Client-safe.

/**
 * 409 GENERATION_IN_PROGRESS: the same JD is already being generated in
 * another tab or device (migration 013). Nothing was charged and nothing
 * failed, so it must not be shown as "Something went wrong".
 */
export function isAlreadyGenerating(status: number, body: unknown): boolean {
  return status === 409 && (body as { error?: unknown } | null)?.error === "GENERATION_IN_PROGRESS";
}

export const ALREADY_GENERATING = {
  title: "Already generating in another tab",
  message:
    "This resume is being generated in another tab or window. It will appear on your dashboard when it's ready — no extra credit is used.",
} as const;
