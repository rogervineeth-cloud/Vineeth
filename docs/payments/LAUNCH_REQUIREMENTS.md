# Razorpay checkout — what is still required before activation

This branch adds **test-mode-capable infrastructure only**. Payments are **off
by default** and stay off until every item below is done and confirmed. No
keys, credentials, Razorpay calls, cloud migrations or deployments were made
by the commit that adds this file.

What exists in code: migration `supabase/migrations/016_payment_orders.sql`
(+ rollback), `lib/payments/*`, `POST /api/payments/orders`,
`POST /api/payments/verify`, `POST /api/payments/razorpay/webhook`, the
gated `BuyButton` / `PurchaseCta`, and tests (`__tests__/payments-*.test.ts`,
`__tests__/migration-016-sql.test.ts`).

---

## 1. Business decisions (owner)

| # | Decision | Why it blocks launch |
|---|---|---|
| D1 | **Refund policy** — full / partial / none; what happens to credits already used from a refunded pack; whether a refunded LinkedIn Rewrite already used is refundable | Refunds are recorded (`payment_refunds`, order status) but **credits and add-ons are NOT revoked automatically**. A revocation rule must be chosen and implemented before live refunds. |
| D2 | **Credit spending order** when an account holds both Free Beta credits and a purchased pack | Migration 013 charges the **newest** plan with a credit first, so a purchase made after the beta grant is spent before the free beta credits. Confirm or change. |
| D3 | **GST** — are ₹99 / ₹249 / ₹599 / ₹999 / ₹499 / ₹399 GST-inclusive? Is a GSTIN registered? Are tax invoices required? | Prices are charged exactly as displayed. Invoices are not generated. |
| D4 | **LinkedIn Rewrite** — is it ready to sell (standalone ₹499 and ₹399 bundle)? | The rewrite route exists (`app/api/linkedin-rewrite/route.ts`, gated by `PRICING_V2`) but the README still says it is not functional. |
| D5 | **Account deletion with purchases** | Orders are kept with `user_id` set to null (financial records); granted plans are deleted with the account. Confirm this matches the privacy/refund policy. |
| D6 | **Free Beta at launch** — keep, change, or end the 3 free generations? | Copy on the landing page, `/pricing`, dashboard and create page still describes the beta (`lib/plan-config.ts` `BETA_EXHAUSTED_MESSAGE`, `components/beta/FreeBetaCard.tsx`). The landing/pricing notices switch automatically when checkout is enabled; the in-app beta messages do not. |

## 2. Razorpay account (owner)

- [ ] KYC completed and the account **activated for live payments**.
- [ ] Website/app details submitted to Razorpay match the live domain.
- [ ] **Test** key pair generated (Dashboard → Account & Settings → API Keys, test mode).
- [ ] **Live** key pair generated only after activation.
- [ ] **Payment capture: automatic.** The verify endpoint grants only on `captured`; an `authorized` payment returns "pending" and is granted when the `payment.captured` webhook arrives. Manual capture is not implemented.
- [ ] Payment methods enabled (UPI / cards / netbanking / wallets) — choice is the owner's.
- [ ] Business name / logo / brand colour for the Checkout window. (Code passes only `name: "Neduresume"`.)
- [ ] **Webhooks** (one per mode), URL `https://<live-or-preview-domain>/api/payments/razorpay/webhook`, a **dedicated webhook secret**, events:
      `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`.
      (Other events are acknowledged and ignored.)

## 3. Credentials and configuration (owner, Vercel)

Exactly four variables. **Values are never committed, logged or exposed to the
browser; there is no `NEXT_PUBLIC_` payment variable.**

| Variable | Preview / Development | Production |
|---|---|---|
| `PAYMENTS_ENABLED` | `true` only while testing | `true` only at go-live |
| `RAZORPAY_KEY_ID` | `rzp_test_…` | `rzp_live_…` |
| `RAZORPAY_KEY_SECRET` | test secret (Sensitive) | live secret (Sensitive) |
| `RAZORPAY_WEBHOOK_SECRET` | test webhook secret (Sensitive) | live webhook secret (Sensitive) |

Guard rails enforced in `lib/payments/config.ts` (tested in `__tests__/payments-config.test.ts`):
- anything but `PAYMENTS_ENABLED=true` → off;
- `rzp_live_` outside `VERCEL_ENV=production` → off;
- `rzp_test_` in production → off (production only ever takes live payments);
- a missing secret or malformed key id → off.

Vercel applies env changes to **new deployments**: redeploy after changing
them. `/pricing` is statically rendered, so its buy buttons follow the config
of the deployment that built it; the API re-checks the config on every request.

Other existing settings that must be right at go-live:
- `SITE_AUTH_USER` / `SITE_AUTH_PASS` (site Basic-auth gate, `middleware.ts`) must be **removed** for a public launch, or customers cannot reach checkout. (`/api/*`, including the webhook, is already outside the gate.)
- `NEXT_PUBLIC_TEST_MODE` must be unset in production.
- If a Content-Security-Policy is ever added (`next.config.ts` sets none today), it must allow `https://checkout.razorpay.com` (script, frame) and `https://api.razorpay.com` (connect).

## 4. Domain, legal and support (owner — not written by engineering)

No public legal content or business details were invented. Required before
Razorpay website activation and before live checkout, linked from the footer
(`app/page.tsx` footer currently has only "© 2026 Neduresume · Made in India"
and a personal `mailto:`):

- [ ] **Live domain** chosen and attached (the README mentions `neduresume.in`; production currently serves `vineeth-wine.vercel.app`).
- [ ] **Terms & Conditions**
- [ ] **Privacy Policy** — must disclose processors: Anthropic (profile and job-description text sent for generation), Supabase (database; project region), Vercel (hosting), Razorpay (payments).
- [ ] **Refund & Cancellation Policy** (decision D1)
- [ ] **Shipping / Delivery Policy** (digital credits, delivered on payment confirmation)
- [ ] **Contact Us** — business name, address, support email/phone as registered with Razorpay. `app/pricing/PricingClient.tsx` shows `support@neduresume.com`: confirm the mailbox exists or change it.
- [ ] Customer-facing claims honoured by policy: "All plans valid 1 year · No subscription · Pay once, use anytime", "Unlimited PDF downloads", "Live ATS keyword score", "save ₹100".
- [ ] README updated (still says "All downloads are free" / "Razorpay not yet integrated").

## 5. Database — migration confirmation (owner + engineering)

- [ ] **Confirm production migration state first** (read-only): which of `013`, `014`, `015` are applied; `007_lock_down_user_plans_writes` is applied in production but missing from the repo (add it to the repo).
- [ ] **Renumbering:** branch `claude/ai-job-recommendations-phase-1` also adds `016_job_recommendations.sql`. The two touch no common objects, but Supabase versions migrations by number. Whichever merges second must be renamed to `017_…` (do not apply two `016`s).
- [ ] Dry-run `016` on a copy of the production schema (pattern: `scripts/migration-013-dry-run/`).
- [ ] Apply `016` to production **before** setting `PAYMENTS_ENABLED=true` there (the API fails closed without it: the order call errors with 500, nothing is charged).
- [ ] Rollback `supabase/rollback/016_payment_orders_down.sql` refuses while any order exists (financial records).

## 6. Test-mode matrix (Preview deployment, test keys, 016 applied to a non-production database or after D-decisions)

Use Razorpay's documented test cards / UPI ids (verify against Razorpay's
current docs).

| # | Scenario | Expected |
|---|---|---|
| T1 | Buy each pack: Single, Fresher, Job Hunter, Career Pack | one `user_plans` row: 1 / 5 / 12 / 25 credits, `expires_at` +1 year, `is_test=true`, `payment_order_id` set; order `fulfilled` |
| T2 | Each pack + LinkedIn bundle (₹498 / ₹648 / ₹998 / ₹1398) | pack row + one `user_addons` row |
| T3 | LinkedIn Rewrite alone (₹499) | one `user_addons` row, no credits |
| T4 | Payment failure (failing test card / failure UPI id), then close | "Payment failed: …", no grant, `last_payment_error` set |
| T5 | Close the window without paying | "Checkout closed before the payment was completed.", no grant |
| T6 | Double-click Buy | one order |
| T7 | Pay, then block `/api/payments/verify` (e.g. close the tab immediately) | webhook grants once |
| T8 | Re-send the same webhook from the Dashboard | `duplicate`, no second grant |
| T9 | Tampered request bodies (amount field, other user's order id, forged signature) | ignored / 404 / 400, no grant |
| T10 | Generate resumes with purchased credits | charged by 013; decision D2 order observed |
| T11 | Download a resume after the pack is used up | allowed (`lib/download-entitlement.ts`) |
| T12 | Full and partial refund from the Dashboard | `payment_refunds` rows, order `refunded` / `partially_refunded`; credits per decision D1 (not revoked today) |
| T13 | `PAYMENTS_ENABLED` unset | all three endpoints 503; pages show "Payments coming soon" |
| T14 | A live key on a Preview deployment | payments stay off |
| T15 | Signed-out Buy | redirected to sign in; no order |

## 7. Go / no-go for live

- [ ] Sections 1–5 complete; section 6 passed on Preview with test keys.
- [ ] Refund revocation (D1) implemented and tested, or explicitly accepted as manual.
- [ ] Live keys + live webhook secret set in **Production only**; webhook registered for live mode.
- [ ] `016` applied in production; `SITE_AUTH_*` removed; `NEXT_PUBLIC_TEST_MODE` unset.
- [ ] In-app beta copy updated (D6).
- [ ] Monitoring: alert on webhook 4xx/5xx, on orders with `last_payment_error`, on `needs_review`, and on orders paid but not `fulfilled`.
- [ ] A reconciliation job for paid-but-unfulfilled orders (not built: the webhook plus verify cover normal cases; a protected cron over Razorpay's order/payment API is the recommended follow-up).
- [ ] One low-value live purchase end to end, then refund it, then reconcile against the Razorpay Dashboard.
- [ ] Only then set `PAYMENTS_ENABLED=true` in Production and redeploy.

## Known limitations of this foundation

- Refunds are recorded but do not revoke credits/add-ons (D1).
- No reconciliation job; no invoices/receipts; no purchase-history UI (users can read their own orders under RLS, nothing displays them yet).
- No rate limiting on order creation beyond authentication and one order per request id.
- Manual capture mode is not supported (automatic capture required).
- Checkout copy is minimal; the in-app Free Beta messages are unchanged.
