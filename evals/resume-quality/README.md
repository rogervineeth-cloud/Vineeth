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
| `results/final-live-2` | **fresh live run** with prompt J/K, CANDIDATE_FACTS and the detail/summary/advice guards (`captured/live-final-2`, 2026-09-24) | **11/11** (detail 11/11, framing 11/11, advice 11/11, no years defect) | 1.0 | 0 | strong ×5, adequate ×6 |

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

### Manual audit of `final-live-2` (not a product-quality sign-off)

Closed on this run: no invented method/component/outcome survives in any
bullet or project description (the guard reverted 6 of E's 6 bullets in S10
and 3 of D's in S09 — the model still elaborates despite rule J); S07 and S06
state 3 years, S11 "5+ years" (5.3); every summary opens with who the
candidate is; no advice credits an unevidenced skill.

Still open (found by reading, not scored):
- **Tailoring cost.** Five summaries (S06–S10) fell back to the candidate's
  own summary because every model sentence added something unevidenced
  ("scalable", "systems"), so they no longer name the target role, and D's
  own summary says it targets "embedded development or QA roles" on an SDE
  application. Reverted bullets are truthful but untailored.
- **Advice over-dropping.** S07's growth note lost its explanatory sentence
  (flagged as crediting JavaScript/Python/C++/GCP) and is now a single vague
  line; S10 lost two tips. The route returns only post-processed output, so
  whether each drop was a true or false positive cannot be checked from the
  capture.
- **Numbers in advice are unchecked.** S05's note says "8 of the 10 curated
  keywords" and then lists 9.
- **Mild wording inflation passes.** S06's note: "demonstrates code review and
  microservices architecture" (the profile shows microservices, not
  architecture ownership).
- **ATS score heuristic.** S01 (42) and S10 (48) still trip "undersells a
  matching profile".
- The evaluator's new gates share the guards' idea (evidence by word overlap),
  implemented separately; agreement between them is not independent proof.

## Offline corpus: generalisation and tailoring audit (synthetic)

`offline-corpus/cases/` holds 12 **fictional composite** cases, most of them
non-engineering: marketing, finance (CA), HR, sales, warehouse operations,
data analysis, teacher to instructional designer, support to customer success,
nurse to clinical research, accounting fresher, graphic to UI/UX design and
manufacturing quality. Each has invented people (`example.com`), employers and
colleges, a synthetic JD, and a hand-written model-style rewrite. Its 67 items
are labelled `faithful`, `tailored`, `verb_swap`, `truthful_unscoped`,
`one_unsupported` or `fabricated`.

`npx tsx evals/resume-quality/offline-corpus/audit.ts --save <label>` runs the
production `postProcessResume` over them. It judges each item with the
evaluator's separately implemented checks: kept, trimmed, reverted or dropped;
any unsupported content left; tailoring retained; source numbers kept. Per case
it records the gates, whether the summary names the target role, and whether
every source bullet's numbers survive in the full resume.

| | `offline-corpus-before` (baseline guards) | `offline-corpus-after` (this change) |
|---|---|---|
| Unsupported content left (all 67 items) | 0 | 0 |
| faithful + tailored kept unchanged | 22 / 24 | **24 / 24** |
| one-unsupported items keeping their tailoring | **0 / 22** | **16 / 22** (6 revert) |
| verb swaps keeping the rewrite | 0 / 2 | 1 / 2 |
| truthful synonyms / other-field evidence kept | 0 / 4 | 0 / 4 (known cost) |
| fabricated items keeping anything unsupported | 0 / 15 | 0 / 15 |
| summaries naming the target role | 10 / 12 | **12 / 12** |
| every source bullet's numbers preserved | 11 / 12 | **12 / 12** |
| advice_fidelity (count check) | 8 / 12 | **12 / 12** |

What changed, and why:
- **Trim instead of revert** (`trimToEvidence`, used by the skill, detail and
  summary guards). Only an unsupported clause (", improving…",
  " and partnering…", " by/using/through/via/with/as …", "; …") or modifier
  ("data-driven", "customer-facing") is removed, or an unsupported opening verb
  becomes the source's own verb. The result must:
  - pass the same evidence check;
  - keep every number of the source;
  - keep at least 75% of the source's content words;
  - not end on a dangling clause, and not delete one noun of a coordination.

  Otherwise the guard reverts exactly as before.
- **Naming the role sought is not claiming its skills.** "seeking the UI/UX
  Designer role" and "…the Performance Marketing Manager role" were dropped as
  UI/UX / Performance Marketing claims. The same title claimed as the
  candidate's own is still removed.
- **Identity nouns beyond engineering.** "Chartered Accountant", "HR
  recruiter", "science teacher" and "staff nurse" did not count as saying who
  the candidate is.
- **Displaced achievements restored.** When an unmatchable fabricated bullet is
  dropped, the source bullet it displaced is restored (N09 had lost "Trained 5
  new nurses").
- **Advice counts.** "8 of the 10 curated keywords (…9 items…)" is corrected to
  the list.

**Limits of this evidence:**
- The corpus, its labels and the guards were written by the same author.
  One-unsupported items are shaped like the patterns the fix targets, though
  three are deliberately not (an -ed modifier and two coordinated nouns), and
  those revert.
- It shows the mechanism works and fails safe. It does **not** measure how
  often real model output looks like this, or how the rules behave on real
  profiles in other languages, formats or domains.
- Truthful synonyms ("outbound prospecting calls" for "cold calls") are still
  reverted.
- The live captures store post-processed output, so re-processing them
  (`results/final-live-2-reprocessed`) shows only the advice-count fix. The
  tailoring gain on real model output is unmeasured until a new live run.


## Final live rerun of the tailoring code (`final-live-3`), 2026-09-25

11 fictional scenarios ran on a branch-only preview
(`dpl_A2NURPNRCJM7EPMNisoTGiPimvnr`) between 05:58Z and 06:01Z. Each capture
holds the **raw model reply** (text and parsed JSON, taken before
post-processing) and the post-processed resume. All 11 are SHA-256-verified
against the value the preview computed. Scored: `results/final-live-3`;
compared with `final-live-2` in `results/live-compare-final2-vs-final3`.

| | final-live-2 | final-live-3 |
|---|---|---|
| factual · detail · framing · advice fidelity | 11 · 11 · 11 · 10 | 11 · 11 · 11 · **11** |
| seniority (ATS "undersells" heuristic on S01, S10) | 9 | 9 |
| Final bullets: verbatim source / tailored-clean / unclean | 29 / 5 / 0 | 28 / 6 / 0 |
| Projects: verbatim / tailored-clean | 14 / 1 | 13 / 2 |
| Summary names the target role | 0 | 1 |
| Summary falls back to the candidate's own | 5 | **0** |
| Renders in all 4 PDF templates, one A4 page each | 11 | 11 |

**Raw rewrites** (bullets the model changed): 12 in total, 6 of them with no
unsupported content. 6 were kept and 6 ended as the source bullet. In S10,
trimming the added trailing clause ("…, demonstrating experience with
distributed event-driven systems") leaves exactly the candidate's own bullet.
The model rarely rewrote bullets at all this time: 22 of 34 raw bullets were
already the source verbatim.

**Manual audit: not a pass.** Residual defects:

1. **Summary regression caused by the new trimming (S08, S09, S10).**
   - The final summaries are "QA Engineer." (S08, S09) and "Software Engineer
     (Full Stack)." (S10).
   - The model's first sentence ("QA Engineer with 2+ years of professional
     experience in embedded systems and firmware testing") had one unsupported
     word ("systems"). The clause trim removed the whole " with …" phrase,
     taking the correct years and domain with it.
   - The 2-content-word minimum let a bare title through.
   - `final-live-2` had fuller, truthful summaries for these three.
   - The gates miss it: an identity noun is present and nothing unsupported
     is added.
2. **Target role still rarely named (1/11).** The model's "Seeking the … role
   to …" sentence usually carries unsupported claims in a "to …" purpose clause
   or a "with expertise in …" list, which the trimming does not cover. So it is
   dropped whole.
3. **Advice over-dropping persists.**
   - S07's note loses its explanatory sentence. "…GCP expertise, neither of
     which your profile currently shows" was read as crediting the skills
     ("your profile … shows"), because "neither" is not recognised as negation.
   - S10 and S11 lose 2 tips each; S11 also loses its closing growth-note
     sentence.
4. **Model embellishment is still reverted, not tailored.**
   - Project descriptions in S01–S05 revert, because "designed", "eliminated",
     "deployed" or "integrating" are added.
   - This is truthful, but untailored.
5. **ATS "undersells" heuristic on S01 (42) and S10 (48)**, as before.

**PDF readiness.** Every final resume renders with the production renderer in
all four templates on one A4 page. Growth notes contain "—", but they are not
part of the PDF.

### Fixes for the final-live-3 defects (replayed offline from the raw captures)

`run.ts --captured <label> --reprocess` and `live-tailoring.ts --replay <label>`
now re-run today's post-processing over the captured **raw** model reply
(when the capture has one). Results: `results/final-live-3-replayed`,
`results/live-compare-final2-vs-final3-replayed`.

| final-live-3 (11 scenarios) | as captured (previous code) | replayed (this fix) |
|---|---|---|
| summary_framing (now also fails summaries under 6 words) | 8 | **11** |
| Summary names the target role | 1 | **11** |
| Summary opens with the candidate's identity and years (S08/S09/S10) | bare title ×3 | fixed |
| Tips kept (raw 40) | 34 | **39** |
| Growth-note sentences kept (raw 29) | 27 | **29** |
| factual · detail · advice · ats_keywords | 11 · 11 · 11 · 11 | 11 · 11 · 11 · 11 |
| Final bullets verbatim / tailored-clean | 28 / 6 | 28 / 6 |
| PDF: one A4 page in all 4 templates | 11 | 11 |

- **Summary framing.**
  - A trimmed summary sentence must keep the years claim it made, and must not
    shrink to under 6 words or to title words only.
  - Otherwise the sentence is dropped. The computed opening ("QA Engineer with
    2+ years of professional experience.") or the candidate's own summary
    takes its place.
  - The identity check ignores the sought-role phrase, so "Seeking a Software
    Development Engineer role." no longer counts as saying who the candidate
    is.
- **Target role.**
  - The sought-role phrase itself is masked, including an employer ("…role at
    Google Cloud"), so it is not read as a skill claim.
  - " to <verb> …" purpose clauses are trimmable, so "Seeking the SDE II role
    to deepen expertise in distributed systems…" keeps "Seeking the SDE II
    role." The evaluator masks the same phrase separately, in its fidelity and
    keyword checks.
- **Advice.**
  - "neither", "nor", "none" and "n't" count as negation (S07).
  - "Deepen / build / strengthen your X knowledge|skills|expertise" is advice to
    grow X, not a claim to have it (S10, S11).
  - A tip with a problem keeps its clean leading instruction ("Lead or
    participate in formal code review processes.") instead of being dropped.
- **Still removed, deliberately:** S11's "Formalise your code review
  practices: …", which presupposes practice the profile does not show.

**Remaining limits.**
- S08/S09 lose the model's "embedded … firmware testing" domain words. The
  standard opening is truthful but generic.
- Bullet and project tailoring are unchanged: in this run the model barely
  rewrote bullets, and project embellishments still revert.
- These are replays of one run's raw output; a fresh live run of this code has
  not been done.

## Final live verification of `2bfe4be` (`final-live-4`, 2026-09-25)

11 fictional scenarios ran on the branch-only preview
`dpl_DnT93WnuyKSATnFqdmNfbjAYsxtH` between 06:34Z and 06:38Z. Each capture
holds the raw and the final output, and all 11 are SHA-256-verified. Scored:
`results/final-live-4`; tailoring/PDF comparison:
`results/live-compare-final3-vs-final4`.

| | final-live-3 (as captured) | **final-live-4 (live, 2bfe4be)** |
|---|---|---|
| factual · detail · advice · ats_keywords | 11 · 11 · 11 · 11 | 11 · 11 · 11 · 11 |
| summary_framing (includes the fragment check) | 8 | **11** |
| Summary names the target role | 1 | **11** |
| Keyword precision · unsupported-claim rate | 1.0 · 0 | 1.0 · 0 |
| seniority (ATS "undersells" heuristic, S01/S10) | 9 | 9 |
| Final bullets verbatim / tailored-clean / unclean | 28 / 6 / 0 | 29 / 5 / 0 |
| PDF: one A4 page in all 4 templates | 11 | 11 |
| Tips kept / raw | 34 / 40 | 38 / 39 |
| Growth-note sentences kept / raw | 27 / 29 | 29 / 30 |

**Manual audit: not a clean pass.**
- Fixed live: S08 and S10 now read "<title> with N+ years of professional
  experience. Seeking the <role> role."; the role is named in all 11
  summaries; S10's tips are kept (4/4, tip 3 cut to its clean first half).
- **New defect, S09.** The summary reads "QA Engineer with 2+ years of
  professional experience. Seeking a Software Engineer II role at Google
  Cloud, C++, and test automation."
  - The trim removed ", bringing expertise in Python" only up to the next
    comma, leaving the rest of a list attached to the role.
  - Every gate passes it.
  - Fix needed: a clause cut must not end inside a list (extend to the
    sentence end, or reject the trim).
- **Advice false positive, S03.** "You are a fresher … applying for a role
  requiring 3+ years …" was dropped: "requiring" is not in the requirement
  words, so the role's 3+ years was read as the candidate's claim.
- **S11:** "Formalise your code review practices: …" is still removed
  (deliberate). S07's note is kept in full.
- **Unchanged:**
  - bullets are mostly verbatim (model rewrites are reverted or trimmed back
    to the source);
  - project embellishments in S01–S05 revert;
  - S08/S09 lose the model's domain words ("embedded … firmware testing");
  - the ATS heuristic still fires on S01/S10.
