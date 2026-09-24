# Resume-quality eval — results/before-live

- Mode: **live model (captured from preview: live-before)**  |  Model: `claude-haiku-4-5-20251001`  |  JD sources: OFFICIAL_PARAPHRASE

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
| S01 | 62 | 0.267 | 0 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S02 | 62 | 0.214 | 0.2 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S03 | 58 | 0.214 | 0 | 1 | PASS | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | weak |
| S04 | 62 | 0.08 | 0.5 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S05 | 48 | 0.087 | 0.333 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S06 | 68 | 0.071 | 0.333 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S07 | 68 | 0.161 | 0.4 | 1 | PASS | FAIL | FAIL | PASS | FAIL | PASS | PASS | PASS | weak |
| S08 | 58 | 0.267 | 0 | 1 | PASS | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | weak |
| S09 | 58 | 0.2 | 0.5 | 1 | PASS | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | weak |
| S10 | 78 | 0.237 | 0 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S11 | 72 | 0.324 | 0.25 | 1 | PASS | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | weak |

### Defects

- **S01** [factual_fidelity] unsupported skill "Data Structures"
- **S01** [factual_fidelity] unsupported skill "Algorithms"
- **S01** [factual_fidelity] unsupported skill "Distributed Systems"
- **S01** [factual_fidelity] unsupported skill "Object-Oriented Design"
- **S01** [factual_fidelity] unsupported skill in prose "Data Structures"
- **S01** [factual_fidelity] unsupported skill in prose "Algorithms"
- **S01** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S01** [factual_fidelity] unsupported skill in prose "Object-Oriented Design"
- **S01** [ats_keywords] JD keywords claimed without evidence: Data Structures, Algorithms, Distributed Systems, Object-Oriented Design
- **S02** [factual_fidelity] unsupported skill "System Design"
- **S02** [factual_fidelity] unsupported skill "Distributed Systems"
- **S02** [factual_fidelity] unsupported skill "Code Review"
- **S02** [factual_fidelity] unsupported skill in prose "System Design"
- **S02** [factual_fidelity] unsupported skill in prose "Microservices"
- **S02** [factual_fidelity] unsupported skill in prose "GCP"
- **S02** [ats_keywords] JD keywords claimed without evidence: System Design, GCP, Code Review, Distributed Systems
- **S03** [factual_fidelity] unsupported skill "Algorithms"
- **S03** [factual_fidelity] unsupported skill "Distributed Systems"
- **S03** [factual_fidelity] unsupported skill "Design Patterns"
- **S03** [factual_fidelity] unsupported skill "Code Review"
- **S03** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S03** [factual_fidelity] unsupported skill in prose "Design Patterns"
- **S03** [ats_keywords] JD keywords claimed without evidence: Code Review, Algorithms, Distributed Systems, Design Patterns
- **S03** [seniority_calibration] ats_score 58 too high for a mismatch (cap 55)
- **S04** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S04** [factual_fidelity] unsupported skill in prose "Object-Oriented Design"
- **S04** [ats_keywords] JD keywords claimed without evidence: Distributed Systems, Object-Oriented Design
- **S05** [factual_fidelity] unsupported skill in prose "GCP"
- **S05** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S05** [ats_keywords] JD keywords claimed without evidence: GCP, Distributed Systems
- **S06** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S06** [factual_fidelity] unsupported skill in prose "Design Patterns"
- **S06** [ats_keywords] JD keywords claimed without evidence: Distributed Systems, Design Patterns
- **S07** [factual_fidelity] unsupported skill "System Design"
- **S07** [factual_fidelity] unsupported skill "Distributed Systems"
- **S07** [factual_fidelity] unsupported skill in prose "System Design"
- **S07** [factual_fidelity] unsupported skill in prose "GCP"
- **S07** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S07** [ats_keywords] JD keywords claimed without evidence: System Design, GCP, Distributed Systems
- **S07** [section_completeness] empty "projects" array emitted
- **S08** [factual_fidelity] unsupported skill "Data Structures"
- **S08** [factual_fidelity] unsupported skill "Algorithms"
- **S08** [factual_fidelity] unsupported skill "Distributed Systems"
- **S08** [factual_fidelity] unsupported skill "Object-Oriented Design"
- **S08** [factual_fidelity] unsupported skill in prose "Data Structures"
- **S08** [factual_fidelity] unsupported skill in prose "Algorithms"
- **S08** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S08** [factual_fidelity] unsupported skill in prose "Object-Oriented Design"
- **S08** [ats_keywords] JD keywords claimed without evidence: Data Structures, Algorithms, Distributed Systems, Object-Oriented Design
- **S08** [seniority_calibration] ats_score 58 too high for a mismatch (cap 55)
- **S08** [seniority_calibration] summary presents the target title "Software Development Engineer" as the candidate's own level
- **S09** [factual_fidelity] unsupported skill "System Design"
- **S09** [factual_fidelity] unsupported skill "Distributed Systems"
- **S09** [factual_fidelity] unsupported skill "Code Review"
- **S09** [factual_fidelity] unsupported skill in prose "System Design"
- **S09** [factual_fidelity] unsupported skill in prose "Code Review"
- **S09** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S09** [ats_keywords] JD keywords claimed without evidence: System Design, Code Review, Distributed Systems
- **S09** [seniority_calibration] ats_score 58 too high for a mismatch (cap 55)
- **S10** [factual_fidelity] unsupported skill "Algorithms"
- **S10** [factual_fidelity] unsupported skill "Distributed Systems"
- **S10** [factual_fidelity] unsupported skill "Design Patterns"
- **S10** [factual_fidelity] unsupported skill "Code Review"
- **S10** [factual_fidelity] unsupported skill in prose "Microservices"
- **S10** [factual_fidelity] unsupported skill in prose "Code Review"
- **S10** [factual_fidelity] unsupported skill in prose "Algorithms"
- **S10** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S10** [factual_fidelity] unsupported skill in prose "Design Patterns"
- **S10** [ats_keywords] JD keywords claimed without evidence: Code Review, Algorithms, Distributed Systems, Design Patterns
- **S11** [factual_fidelity] unsupported skill "Python"
- **S11** [factual_fidelity] unsupported skill "C++"
- **S11** [factual_fidelity] unsupported skill "System Design"
- **S11** [factual_fidelity] unsupported skill "Distributed Systems"
- **S11** [factual_fidelity] unsupported skill "Code Review"
- **S11** [factual_fidelity] unsupported skill "GCP"
- **S11** [factual_fidelity] unsupported skill in prose "Microservices"
- **S11** [factual_fidelity] unsupported skill in prose "System Design"
- **S11** [factual_fidelity] unsupported skill in prose "GCP"
- **S11** [factual_fidelity] unsupported skill in prose "Code Review"
- **S11** [factual_fidelity] unsupported skill in prose "Distributed Systems"
- **S11** [factual_fidelity] unverifiable number "5 (in Brightline Retail Tech bullet)"
- **S11** [ats_keywords] JD keywords claimed without evidence: System Design, GCP, Code Review, Python, C++, Distributed Systems
