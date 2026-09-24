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
| D | 2.1 years of BLE/embedded QA, then an explicit 8-month career break (Jan–Aug 2026); targets embedded dev/QA |
| E | Multi-role: 4.3 years of full-stack development plus 1 earlier year of QA (5.3 professional years); broad skills, so targeting must select evidence |

| JD | Status |
|---|---|
| `GOOG-SWE2`: Google Software Engineer II, Google Cloud, Bengaluru | **OFFICIAL_PARAPHRASE** (verified 2026-09-24) |
| `AMZ-SDE2`: Amazon SDE II, Job ID 10533780, Bengaluru | **OFFICIAL_PARAPHRASE** (verified 2026-09-24) |
| `AMZ-SDE`: Amazon SDE, Job ID 2968029 | **OFFICIAL_PARAPHRASE** (verified 2026-09-24) |

The project owner independently verified the JD requirements against the
official postings; the URLs are in each fixture. The wording is condensed, not
verbatim, and no requirement has been added. The eval environment itself cannot
reach the careers sites. The Amazon SDE posting states no minimum years, so
level fit for S01 and S04 is judged as entry-level.

Each profile's `facts` (professional years, gap) are as of its `facts_as_of`
date (2026-09-24); the runner reads "Present" on that date, and a test checks
the facts against `lib/profile-facts.ts`. Months are counted inclusively and
internships are excluded.

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
| `detail_fidelity` | A rewrite elaborates instead of rephrasing: a bullet adds a content word absent from its own role (title, company, bullets), a project description one absent from that project, or the summary one absent from the whole profile and the target title. Only function words, units and plain execution verbs ("built", "wrote", "fixed") may be new. Catches invented methods ("batch jobs"), components, qualities ("scalable") and outcomes ("improving resilience"). |
| `ats_keywords` | Keyword precision < 1 (a JD keyword is claimed without evidence), truthful recall < 0.8, or the candidate is told to "add" a skill they already have |
| `seniority_calibration` | For under/mismatch scenarios: `ats_score` is above 65/55 or there is no `growth_note`. Also fails when a summary years claim is over- or understated (supported only if floor(M) ≤ claim ≤ M + 0.5, where M is total professional years or, unless the claim is about "professional experience" as a whole, one employer's tenure), presents the target title as the candidate's own level, or undersells a match (< 50). |
| `section_completeness` | A section with profile data is dropped, an empty array is emitted, or there are more than 15 skills |
| `readability` | The summary is over 90 words, a bullet is over 220 characters or starts with a weak opener, a role has more than 5 bullets, the text is in first person, it contains non-ASCII characters, or it runs over 750 words |
| `career_gap` | An experience entry's dates cover the declared break |
| `projects_vs_employment` | A project is shown as a job, experience is invented for a candidate with no employment, or an internship is relabelled |
| `summary_framing` | The summary's first sentence does not say who the candidate is (no role/identity noun — e.g. opens "Proficient in Java...") |
| `advice_fidelity` | `growth_note` or a tip credits the candidate with a skill the profile does not show ("You have strong distributed systems fundamentals", "your system design contributions", "Strong match on ..."), misstates their years, or tells them to put an unevidenced skill on the resume ("add a bullet describing a code review initiative"). Advice to gain a skill, stated gaps and JD requirements pass. |

**Interview chance** is derived from the gates:
- **weak:** any provable false claim (`factual_fidelity`, `detail_fidelity`, `projects_vs_employment`, `career_gap`);
- **strong:** the resume gates pass (advice is not part of the resume) and the first role shows JD-relevant evidence;
- **adequate:** otherwise.

It is a heuristic.

The detail, years and advice checks mirror production guards in
`lib/detail-evidence.ts`, `lib/profile-facts.ts` and `lib/resume-generation.ts`
but are implemented separately (different tokeniser and stemming, a smaller
neutral vocabulary), so a guard pass is not the evaluator grading itself
line-for-line. They are still heuristics built on the same idea; the manual
audit remains necessary.

Skill detection uses `lib/score-free`'s lexicon, which is independent of the
create page's extractor, plus a small eval-only vocabulary (`EXTRA_TERMS`).
The evaluator's own tests are in `__tests__/resume-quality-eval.test.ts`.

## Results

**Live model runs** (`claude-haiku-4-5-20251001`, the production standard model). They ran on a Vercel preview through a temporary, token-gated route using the shared generation path; that route has since been removed. Every capture in `captured/` is checked against the SHA-256 the preview computed.

| Matrix | Code | Fidelity | KW precision | Unsupported rate | Interview chance |
|---|---|---|---|---|---|
| `results/before-live` | main's prompt and sanitiser | **0/11** | 0–0.5 | 0.07–0.31 | weak ×11 |
| `results/before-live-guard-only` | before-output, re-post-processed with the new guard | 11/11 | 1.0 | 0 | — |
| `results/after-live` | new prompt and guard, old metric grounding | 10/11 | 1.0 | 0–0.03 | S10 weak |
| `results/final-live` | prompt H/I, evidence guard, per-entry metric grounding | 11/11 | 1.0 | 0 | strong ×5, adequate ×6 |
| `results/final-live-rescored` | the same captures, scored with the new gates | 11/11 (detail **0/11**, framing 9/11, advice 9/11, seniority 8/11) | 1.0 | 0 | weak ×11 |
| `results/final-live-reprocessed` | the same captures, re-post-processed with the detail/summary/advice guards | 11/11 (detail 11/11, framing 11/11, advice 11/11) | 1.0 | 0 | strong ×5, adequate ×6 |

What changed between them:
- **Prompt:** rules H (skills are evidence-only) and I (own title, honest level).
- **Evidence guard:** unsupported skills, project tech and matched keywords are removed. A bullet or description that claims an unevidenced skill, or adds a practice its source never named, reverts to the candidate's own wording.
- **Metric grounding:** numbers are checked against their own role or project, and an offending bullet reverts rather than being deleted.
- **Normaliser:** no empty sections.

`final-live` flags S01 and S10 as "undersells a matching profile". This is the evaluator's `match ≥ 50` heuristic firing on candidates who lack most of the JD's named skills; the scores are honest.

The manual audit of `final-live` found what its 11/11 missed: invented detail
("using Spring Boot batch jobs", "Java batch processing", "optimising query
patterns"), S07's "1+ year" for 3.2 years, S10's "3 years" for 5.3, S02/S09
summaries opening "Proficient in ...", and advice crediting unevidenced skills
(S10, S11). `final-live-rescored` shows the evaluator now fails all of them;
`final-live-reprocessed` shows the new guards close them on the same model
output. What changed:
- **Prompt:** CANDIDATE_FACTS (years computed from durations, identity
  opening) in the payload; rules J (rephrase, don't elaborate) and K (advice is
  evidence-only); no unevidenced soft-skill claims in the summary.
- **Detail guard:** a bullet or project description that adds unevidenced
  content reverts to the candidate's own text (never dropped).
- **Summary guard:** sentences with unsupported years or detail are dropped;
  if none is left the candidate's own summary is used; a summary that does not
  open with who the candidate is gets the computed identity sentence first.
- **Advice guard:** overclaiming `growth_note` sentences and tips are dropped;
  an emptied note is rebuilt from `missing_keywords`.

**Offline payload matrices** (pre-model): `results/before-offline.md` → `results/after-offline.md`, **6/11 → 10/11**.
