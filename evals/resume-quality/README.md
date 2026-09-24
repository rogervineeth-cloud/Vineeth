# Resume-quality eval

A non-production evaluation of Neduresume's resume generation. It runs the
**production** path: `lib/resume-generation.ts` provides the same system
prompt, payload builder, Messages request (model, temperature 0, `{` prefill),
reply parser, sanitiser and normaliser that `app/api/generate-resume/route.ts`
uses. The JD keywords come from `lib/jd-keywords.ts`, the same extractor the
create page runs in the browser. There is **no auth, no credit change and no
database access**. A test proves that nothing in the harness's import graph
loads `lib/plans` or `lib/supabase`.

## Run

```bash
npm run eval:resumes                     # live model: requires ANTHROPIC_API_KEY
npm run eval:resumes -- --offline        # everything that needs no model
npm run eval:resumes -- --only S03,S10   # subset
npm run eval:resumes -- --save results/after-live   # also write a committed summary
```

Each run writes to `out/<run-id>/` (gitignored):
- `<scenario>.json`: the payload report, raw reply, final resume, sanitiser output and evaluation
- `results.json` / `results.md`: the matrix

## Fixtures

| | Profile (fictional composite; no real person, name, contact or text) |
|---|---|
| A | Project-heavy fresher: Java/Spring Boot, SQL, REST, React/TS, Docker, Razorpay; no employment |
| B | 2023 B.Tech with one backend internship; Java/Spring Boot/MySQL/REST, React, e-commerce project, AWS, DSA |
| C | 3.2-year backend engineer: Java/Spring Boot/microservices/MySQL/JPA/Hibernate, Agile; the candidate supplied the metrics |
| D | 2 years of BLE/embedded QA, then an explicit 8-month career break (Jan–Aug 2026); targets embedded dev/QA |
| E | Multi-role: full-stack development plus earlier QA; broad skills, so targeting must select evidence |

| JD | Status |
|---|---|
| `GOOG-SWE2`: Google Software Engineer II, Google Cloud, Bengaluru | **RECONSTRUCTED_PLACEHOLDER** |
| `AMZ-SDE2`: Amazon SDE II, Job ID 10533780 | **RECONSTRUCTED_PLACEHOLDER** |
| `AMZ-SDE`: Amazon SDE, Job ID 2968029 | **RECONSTRUCTED_PLACEHOLDER** |

The official pages could not be fetched from the environment these fixtures
were built in, because network egress to `www.google.com` and
`www.amazon.jobs` was blocked. The JD texts reconstruct the standard shape of
these postings and are **not verbatim**. To make results final, paste each
official posting into the fixture's `text` and set `"source_status":
"OFFICIAL"`. Every result row records the source status.

`scenarios.json` holds 11 profile × JD pairs, including deliberate seniority
mismatches (S03 fresher vs SDE II; S08/S09 off-domain returner).

## What is scored (`evaluate.ts`)

**Pre-model payload.** This is what production would send:
- a truthful skill marked `JD_ONLY` (the model is told never to claim it);
- an absent skill marked `INTERSECTION` (the model is told to include it);
- a curated keyword that is not in the JD;
- must-include coverage of every truthful JD requirement. The gate is ≥ 0.8.

**Generated resume.** One gate per dimension:

| Gate | Fails when |
|---|---|
| `factual_fidelity` | An employer, role, duration, institution, project, skill or number is not in the profile. Also reports the unsupported-claim rate. |
| `ats_keywords` | Keyword precision < 1 (a JD keyword is claimed without evidence), truthful recall < 0.8, or the candidate is told to "add" a skill they already have |
| `seniority_calibration` | For under/mismatch scenarios: `ats_score` is above 65/55 or there is no `growth_note`. Also fails when the summary claims more years than the profile, presents the target title as the candidate's own level, or undersells a match (< 50). |
| `section_completeness` | A section with profile data is dropped, an empty array is emitted, or there are more than 15 skills |
| `readability` | The summary is over 90 words, a bullet is over 220 characters or starts with a weak opener, a role has more than 5 bullets, the text is in first person, it contains non-ASCII characters, or it runs over 750 words |
| `career_gap` | An experience entry's dates cover the declared break |
| `projects_vs_employment` | A project is shown as a job, experience is invented for a candidate with no employment, or an internship is relabelled |

**Interview chance** is derived from the gates:
- **weak:** any provable false claim;
- **strong:** every gate passes and the first role shows JD-relevant evidence;
- **adequate:** otherwise.

It is a heuristic.

Skill detection uses `lib/score-free`'s lexicon, which is independent of the
create page's extractor, plus a small eval-only vocabulary (`EXTRA_TERMS`).
The evaluator's own tests are in `__tests__/resume-quality-eval.test.ts`.

## Results

- `results/before-offline.md`: the pre-fix payload matrix. **5 of 11 fail**: truthful DSA, code review and accessibility evidence was never marked "include".
- `results/after-offline.md`: after the fixes, **11 of 11 pass**.
- Generated-resume gates are **BLOCKED** in both until the harness runs with `ANTHROPIC_API_KEY`.
