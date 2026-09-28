# Resume-quality eval — results/before-live-guard-only

- Mode: **live model (captured from preview: live-before, re-post-processed with current code)**  |  Model: `claude-haiku-4-5-20251001`  |  JD sources: OFFICIAL_PARAPHRASE

## Pre-model payload (what production would send)

| Scenario | Profile × JD | Fit | Curated | Truthful skill marked 'never claim' | Absent skill marked 'inject' | Curated not in JD | Must-inject coverage | Truthful requirements not licensed | Gate |
|---|---|---|---|---|---|---|---|---|---|
| S01 | A × AMZ-SDE | match | 4 | - | - | - | 1 | - | PASS |
| S02 | A × GOOG-SWE2 | under | 10 | - | - | - | 1 | - | PASS |
| S03 | A × AMZ-SDE2 | mismatch | 4 | - | - | - | 1 | - | PASS |
| S04 | B × AMZ-SDE | match | 4 | - | - | - | 1 | - | PASS |
| S05 | B × GOOG-SWE2 | under | 10 | - | - | - | 1 | - | PASS |
| S06 | C × AMZ-SDE2 | match | 4 | - | - | - | 1 | - | PASS |
| S07 | C × GOOG-SWE2 | match | 10 | - | - | - | 1 | - | PASS |
| S08 | D × AMZ-SDE | mismatch | 4 | - | - | - | 1 | - | PASS |
| S09 | D × GOOG-SWE2 | mismatch | 10 | - | - | - | 0.667 | C | FAIL |
| S10 | E × AMZ-SDE2 | match | 4 | - | - | - | 1 | - | PASS |
| S11 | E × GOOG-SWE2 | match | 10 | - | - | - | 1 | - | PASS |

## Generated resume

| Scenario | ATS | Unsupported rate | KW precision | KW recall | structural_validity | factual_fidelity | ats_keywords | seniority_calibration | section_completeness | readability | career_gap | projects_vs_employment | Interview chance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | 62 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | strong |
| S02 | 62 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | strong |
| S03 | 58 | 0 | 1 | 1 | PASS | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | adequate |
| S04 | 62 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | adequate |
| S05 | 48 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | adequate |
| S06 | 68 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | strong |
| S07 | 68 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | strong |
| S08 | 58 | 0 | 1 | 1 | PASS | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | adequate |
| S09 | 58 | 0 | 1 | 1 | PASS | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | adequate |
| S10 | 78 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | adequate |
| S11 | 72 | 0 | 1 | 1 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | adequate |

### Defects

- **S03** [seniority_calibration] ats_score 58 too high for a mismatch (cap 55)
- **S08** [seniority_calibration] ats_score 58 too high for a mismatch (cap 55)
- **S08** [seniority_calibration] summary presents the target title "Software Development Engineer" as the candidate's own level
- **S09** [seniority_calibration] ats_score 58 too high for a mismatch (cap 55)
