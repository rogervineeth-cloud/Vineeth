// Tiny analytics shim. Intentionally has zero deps and no network calls.
// In dev/SSR it console.logs; in prod it no-ops unless a future provider is
// wired in here. Replace the body of `track` to forward to a real provider
// when one is chosen — call sites do not need to change.
//
// Spec'd events:
//   pricing_view, plan_click, addon_toggle, checkout_start, checkout_success,
//   free_review_start, free_review_complete, generate_attempt_blocked_free
export type AnalyticsEvent =
  | "pricing_view"
  | "plan_click"
  | "addon_toggle"
  | "checkout_start"
  | "checkout_success"
  | "free_review_start"
  | "free_review_complete"
  | "generate_attempt_blocked_free"
  | "generate_resume_sanitised";

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[analytics] ${event}`, props);
  }
}
