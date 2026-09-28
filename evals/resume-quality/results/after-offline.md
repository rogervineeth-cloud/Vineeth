# Resume-quality eval — results/after-offline

- Mode: **offline (no model)**  |  Model: `claude-haiku-4-5-20251001`  |  JD sources: OFFICIAL_PARAPHRASE

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

| Scenario | ATS | Unsupported rate | KW precision | KW recall | factual_fidelity | ats_keywords | seniority_calibration | section_completeness | readability | career_gap | projects_vs_employment | Interview chance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | BLOCKED: offline run | | | | | | | | | | | |
| S02 | BLOCKED: offline run | | | | | | | | | | | |
| S03 | BLOCKED: offline run | | | | | | | | | | | |
| S04 | BLOCKED: offline run | | | | | | | | | | | |
| S05 | BLOCKED: offline run | | | | | | | | | | | |
| S06 | BLOCKED: offline run | | | | | | | | | | | |
| S07 | BLOCKED: offline run | | | | | | | | | | | |
| S08 | BLOCKED: offline run | | | | | | | | | | | |
| S09 | BLOCKED: offline run | | | | | | | | | | | |
| S10 | BLOCKED: offline run | | | | | | | | | | | |
| S11 | BLOCKED: offline run | | | | | | | | | | | |
