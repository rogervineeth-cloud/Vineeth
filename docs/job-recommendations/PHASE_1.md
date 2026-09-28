# AI Job Recommendations: Phase 1

This slice is off by default. It has not been deployed, the migration has not been applied, and no provider is connected.

## Flags (server-side env only)

| Variable | Default | Effect |
|---|---|---|
| `JOB_RECOMMENDATIONS_ENABLED` | unset (off) | Only `true` turns it on. When off, `/job-recommendations` and `/api/job-recommendations/*` return 404. |
| `JOB_RECOMMENDATIONS_PROVIDER` | unset | Must be on the allowlist (`fixture` only). If unset or unknown, the page shows the honest **unavailable** state. |
| `JOB_RECOMMENDATIONS_FIXTURE_SCENARIO` | `default` | Dev/test only: `default`, `partial`, `empty` or `error`. |

The `fixture` provider hard-fails in production (`VERCEL_ENV=production` or `NODE_ENV=production`, which includes local `next start`), so it never serves fake jobs to users. To try the feature locally, use `next dev` with `JOB_RECOMMENDATIONS_ENABLED=true JOB_RECOMMENDATIONS_PROVIDER=fixture`, with migration 016 applied to a **local/dev** database.

## Flow

1. Consent (`POST /api/job-recommendations/consent`, `{action:"grant"|"revoke"}`). Revoking deletes every stored run and recommendation for the user.
2. Profile normalisation (`lib/job-recs/profile.ts`) uses only explicit facts: target roles, role titles, listed skills, project tech, total years and city. It never uses name, email, phone, graduation year, summary, bullets or education.
3. The provider receives **titles and skills only** (`providerQuery`). Items are normalised to allowed fields straight away. Anything else is discarded, including jobs whose apply links aren't HTTPS.
4. Scoring is deterministic v1 (`lib/job-recs/scoring.ts`): skills 50%, title 30%, experience 15%, location 5%. Each component's score, weight and reason is stored with the recommendation.
5. `POST /api/job-recommendations` `{request_key}` is idempotent per key. The limit is 5 runs per user per rolling hour, enforced in the database under a per-user lock, plus a per-instance burst limiter.
6. Save/dismiss/reset go through `PATCH /api/job-recommendations/:id`, scoped to the session user. Dismissed jobs are left out of later runs, and saved jobs stay saved.

## Database (migration 016)

The migration adds `job_rec_consents`, `job_rec_runs` and `job_recommendations`. Owners can SELECT their own rows under RLS. All writes go through service-role-only functions. It stores no resume text and no raw provider payloads, only a profile fingerprint. Apply links have an HTTPS check constraint.
Rollback: `supabase/rollback/016_job_recommendations_down.sql` (drops only this feature's tables and functions).

## Not in Phase 1

- A real job provider (a vetted, contracted API; no scraping), plus its terms review and key management
- An entry point in navigation (the page is reachable only by URL while the flag is on)
- Durable cross-instance burst limiting (the durable limit is on run creation)
- Background refresh, notifications and analytics
