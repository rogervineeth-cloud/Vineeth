# Pricing Revamp — Manual Smoke Checklist

This checklist replaces interactive screenshots for the pricing-v2 PR.
The agent that produced the PR runs in a sandbox without a browser, so the
operator running `npm run dev` should walk through every item below and
attach screenshots into this directory.

Required environment:
- `ANTHROPIC_API_KEY` set (for the post-grant generate-resume step).
- `NEXT_PUBLIC_TEST_MODE=true` (exposes the "Grant test plan (dev)" button).
- Supabase env vars set as usual.
- `PRICING_V2` UNSET (defaults to enabled). Re-run the bottom of the
  checklist with `PRICING_V2=false` to verify the rollback flag.

## Walk-through

- [ ] **`/`** — hero footnote reads exactly:
      *"Free ATS review · Resumes from ₹99 · Pay once, no subscription"*.
- [ ] **`/`** — Pricing strip shows a Free banner above the grid; grid has
      4 paid cards in order Single → Fresher (Most popular) → Job Hunter
      → Career Pack. Footnote: *"+ LinkedIn Profile Rewrite add-on — ₹499
      standalone, ₹399 bundled with any plan"*.
- [ ] **`/` FAQ** — *"What is the LinkedIn Profile Rewrite?"* entry is
      present with a 2–3 sentence answer.
- [ ] **`/pricing`** — banner above grid; 4 cards in correct order;
      LinkedIn Rewrite card (dashed border, ₹499) below the grid.
- [ ] **`/pricing`** — toggle "Add LinkedIn Rewrite +₹399" on the Single
      card → totals on every card update (Single ₹498, Fresher ₹668,
      Job Hunter ₹998, Career Pack ₹1398).
- [ ] **`/pricing`** — click "Choose Single" with toggle OFF: toast says
      *"Payment integration coming soon!"* and references ₹99.
- [ ] **`/pricing`** — click "Choose Single" with toggle ON: toast
      references ₹498 and includes "+ LinkedIn Rewrite".
- [ ] **`/free-review`** — paste any resume + JD ≥ 50 chars; click
      "Run free ATS review". Open DevTools → Network tab; assert NO
      request hits `api.anthropic.com`. Only request should be
      `POST /api/score-free`.
- [ ] **`/free-review`** — result panel renders ATS score, matched/
      missing keyword chips, and structure flag suggestions. The
      "Generate ATS-tailored resume — ₹99" CTA at the bottom routes to
      `/pricing`.
- [ ] **`/pricing` (logged in, TEST_MODE on)** — click "Grant test plan
      (dev)" on Single with the LinkedIn toggle ON. Toast reports the
      plan + LinkedIn Rewrite entitlement granted.
- [ ] **`/dashboard`** — confirm credits available; click into resume
      generation flow. `POST /api/generate-resume` returns 200, draft
      renders, ATS score visible.
- [ ] **`/dashboard/linkedin`** — submit URL + current text + target
      role. Without entitlement: 402 with the "Get LinkedIn Rewrite"
      CTA. With entitlement (granted in step above): renders Headline,
      About, and exactly 3 Experience sections.
- [ ] **DB sanity** — `select plan_type, count(*) from user_plans group
      by plan_type;` returns only `single | fresher | job_hunter |
      career` (no rows with `starter` or `placement_pro`).

## Rollback flag spot-check

Restart the dev server with `PRICING_V2=false`:

- [ ] `/pricing` no longer shows: the Free banner, the per-card
      LinkedIn add-on toggle, or the standalone LinkedIn Rewrite card.
      The 4 paid plans still render (the rename is durable).
- [ ] `GET /free-review` → 404.
- [ ] `POST /api/score-free` → 404.
- [ ] `GET /dashboard/linkedin` → 404 (or notFound).
- [ ] `POST /api/linkedin-rewrite` → 404.

## Notes

The agent could not produce screenshots. Operator should attach images
under this directory (`/docs/pricing-revamp-smoke/`) named:
`01-home.png`, `02-pricing.png`, `03-free-review.png`,
`04-linkedin-dashboard.png`, `05-rollback.png`.
