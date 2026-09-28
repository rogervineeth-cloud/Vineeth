# Resume-quality eval — results/final-live-rescored

- Mode: **live model (captured from preview: live-final)**  |  Model: `claude-haiku-4-5-20251001`  |  JD sources: OFFICIAL_PARAPHRASE

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

| Scenario | ATS | Unsupported rate | KW precision | KW recall | structural_validity | factual_fidelity | detail_fidelity | ats_keywords | seniority_calibration | summary_framing | section_completeness | readability | career_gap | projects_vs_employment | advice_fidelity | Interview chance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S01 | 38 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S02 | 48 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S03 | 38 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S04 | 58 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S05 | 42 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S06 | 68 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S07 | 58 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S08 | 38 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | weak |
| S09 | 48 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | weak |
| S10 | 48 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | FAIL | weak |
| S11 | 68 | 0 | 1 | 1 | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | weak |

### Defects

- **S01** [seniority_calibration] ats_score 38 undersells a matching profile
- **S01** [detail_fidelity] project PaySplit - Group Expense Settlement adds "ensuring, robust, error, handling, state, management"
- **S01** [detail_fidelity] project Campus Library Reservations adds "designed, eliminating, transactional, consistency"
- **S01** [detail_fidelity] project Order Tracker Dashboard adds "containerised, deployment"
- **S01** [detail_fidelity] summary adds "proficient, demonstrates, strong, problem, solving, attention, detail, scalable, backend, responsive"
- **S02** [detail_fidelity] project PaySplit - Group Expense Settlement adds "designed, among, users, gateway, handling, transaction, reliability, full, stack, application, consistent, deployment"
- **S02** [detail_fidelity] project Order Tracker Dashboard adds "display, real, time, updates, containerised, testing"
- **S02** [detail_fidelity] summary adds "proficient, demonstrated, ability, design, scalable, user, interfaces, strong, problem, solver, attention, code, quality, system, reliability"
- **S02** [summary_framing] summary opens without the candidate's identity: "Proficient in Java, Spring Boot, and full-stack development "
- **S03** [detail_fidelity] project Order Tracker Dashboard adds "single, page, application, display, real, time, updates, deployed, reproducible, testing, environments"
- **S03** [detail_fidelity] summary adds "proficient, demonstrated, ability, design, scalable, write, comprehensive, suites"
- **S04** [detail_fidelity] Kestrel Commerce Pvt Ltd bullet adds "enabling, seamless, processing": "Built 6 REST endpoints in Spring Boot for the order-returns ..."
- **S04** [detail_fidelity] Kestrel Commerce Pvt Ltd bullet adds "improving, code, reliability": "Wrote JUnit tests for the returns service, raising module co..."
- **S04** [detail_fidelity] Kestrel Commerce Pvt Ltd bullet adds "demonstrating, strong, debugging, problem, solving, skills": "Resolved 12 production bugs reported by the support team, de..."
- **S04** [detail_fidelity] project ShopEase - E-commerce Store adds "architected, features, demonstrating, full, stack, integration, cloud"
- **S04** [detail_fidelity] summary adds "scalable, proficient, problem, solving, skills, distributed, grade, systems"
- **S05** [detail_fidelity] Kestrel Commerce Pvt Ltd bullet adds "enabling, seamless, processing": "Built 6 REST endpoints in Spring Boot for the order-returns ..."
- **S05** [detail_fidelity] Kestrel Commerce Pvt Ltd bullet adds "improving, code, reliability": "Wrote JUnit tests for the returns service, raising module co..."
- **S05** [detail_fidelity] Kestrel Commerce Pvt Ltd bullet adds "debugged, issues, demonstrating, strong, troubleshooting, root, cause, analysis, skills": "Debugged and resolved 12 production issues reported by the s..."
- **S05** [detail_fidelity] project ShopEase - E-commerce Store adds "architected, full, stack, platform, frontend, integrating, transactional, data, image, storage, features, management, workflow, retrieval"
- **S05** [detail_fidelity] summary adds "scalable, demonstrating, problem, solving, ability, attention, code, quality, rigorous"
- **S06** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "optimising, query, patterns": "Reduced p95 latency of the settlement API from 800 ms to 350..."
- **S06** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "architected, migration, independent, improving, deployment, velocity, system, resilience": "Architected and delivered migration of monolithic payouts mo..."
- **S06** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "spring, boot, batch, jobs, manual, overhead": "Automated nightly reconciliation reports using Spring Boot b..."
- **S06** [detail_fidelity] summary adds "scalable"
- **S07** [seniority_calibration] summary understates experience: "1+ year" vs 3.2 professional years
- **S07** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "improving, system, high, throughput, payment, processing": "Reduced p95 latency of the settlement API from 800 ms to 350..."
- **S07** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "architected, deployed, replace, enabling, independent, scaling, faster, feature": "Architected and deployed 4 Spring Boot microservices to repl..."
- **S07** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "ensuring, quality, knowledge, sharing": "Mentored 2 junior engineers and conducted code reviews acros..."
- **S07** [detail_fidelity] Tessellate Fintech Pvt Ltd bullet adds "java, batch, processing": "Automated nightly reconciliation reports using Java batch pr..."
- **S07** [detail_fidelity] summary adds "scalable"
- **S08** [detail_fidelity] Luminar Devices Pvt Ltd bullet adds "ensuring, protocol, reliability": "Tested BLE pairing and GATT services across 12 Android and i..."
- **S08** [detail_fidelity] Luminar Devices Pvt Ltd bullet adds "time, improving, release, velocity": "Automated 150 firmware regression test cases using Python an..."
- **S08** [detail_fidelity] Luminar Devices Pvt Ltd bullet adds "maintaining, quality, standards": "Collaborated with firmware developers to log, triage, and re..."
- **S08** [detail_fidelity] summary adds "systems, strong, problem, solving, attention, detail, scalable, proficient, solid, foundation"
- **S09** [detail_fidelity] Luminar Devices Pvt Ltd bullet adds "ensuring, protocol, reliability": "Tested BLE pairing and GATT services across 12 Android and i..."
- **S09** [detail_fidelity] Luminar Devices Pvt Ltd bullet adds "time, enabling, faster, release, cycles": "Automated 150 firmware regression test cases using Python an..."
- **S09** [detail_fidelity] Luminar Devices Pvt Ltd bullet adds "tracked, ensuring, timely, quality": "Logged, triaged, and tracked defects in JIRA with firmware d..."
- **S09** [detail_fidelity] summary adds "proficient, strong, attention, detail, problem, solving, skills"
- **S09** [summary_framing] summary opens without the candidate's identity: "Proficient in Python, C++, and test automation with strong a"
- **S10** [seniority_calibration] ats_score 48 undersells a matching profile
- **S10** [seniority_calibration] summary understates experience: "3 years" vs 5.3 professional years
- **S10** [detail_fidelity] Orbit Logistics Pvt Ltd bullet adds "frontend, preventing, reaching, production, establishing, best, practices": "Implemented contract tests between tracking API and console ..."
- **S10** [detail_fidelity] summary adds "scalable, applications"
- **S10** [advice_fidelity] growth_note understates experience: "3 years" vs 5.3 professional years
- **S10** [advice_fidelity] growth_note credits the candidate with Code Review, Distributed Systems: "Your current role demonstrates distributed systems exposure (Kafka, Ku"
- **S10** [advice_fidelity] growth_note presupposes the candidate's System Design: "your system design contributions"
- **S10** [advice_fidelity] tip credits the candidate with Code Review: "Lead formal code review processes at your current role and document pa"
- **S11** [detail_fidelity] Orbit Logistics Pvt Ltd bullet adds "designed, ensuring, code, quality, rigorous": "Designed and implemented contract tests between the tracking..."
- **S11** [detail_fidelity] Brightline Retail Tech bullet adds "manual, effort, improving, confidence": "Automated 80 checkout regression tests using Selenium and Ja..."
- **S11** [detail_fidelity] Brightline Retail Tech bullet adds "high, traffic, validating, system, peak, conditions": "Executed JMeter load tests for high-traffic festive-sale rel..."
- **S11** [advice_fidelity] growth_note credits the candidate with Microservices, Distributed Systems: "You have strong full-stack and distributed systems fundamentals (Kafka"
- **S11** [advice_fidelity] tip presupposes the candidate's System Design: "your System Design knowledge"
- **S11** [advice_fidelity] tip tells the candidate to put Code Review, Mentoring on the resume
