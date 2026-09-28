# Offline guard audit — offline-corpus-before

Synthetic, fictional corpus: 12 cases, 67 labelled items. Post-processing = production `postProcessResume`; judged with the evaluator's independent checks. Not real model output; not evidence of real-world rates.

## By item kind

| Kind | n | kept | trimmed | reverted | dropped | unsupported left (leak) | tailoring retained | source numbers kept (bullets/projects) |
|---|---|---|---|---|---|---|---|---|
| faithful | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 7/7 |
| tailored | 17 | 15 | 0 | 0 | 2 | 0 | 15 | 5/5 |
| verb_swap | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 2/2 |
| truthful_unscoped | 4 | 0 | 0 | 4 | 0 | 0 | 0 | 4/4 |
| one_unsupported | 22 | 0 | 0 | 17 | 5 | 0 | 0 | 17/17 |
| fabricated | 15 | 0 | 0 | 7 | 8 | 0 | 0 | 7/8 |

## Case level

- Gates passing (of 12): factual_fidelity 12, ats_keywords 12, seniority_calibration 11, section_completeness 12, readability 12, career_gap 12, projects_vs_employment 12, detail_fidelity 12, summary_framing 12, advice_fidelity 8
- Summary names the target role: 10/12; summary fell back to the candidate's own: 2/12
- Every source bullet's numbers preserved in the full resume: 11/12
- Items that should keep content but lost all tailoring: 30

## Items

| Case | Where | Kind | Outcome | Clean | Final |
|---|---|---|---|---|---|
| N01 | summary | tailored | dropped | yes | — |
| N01 | summary | one_unsupported | dropped | yes | — |
| N01 | bullet | tailored | kept | yes | Ran Google Ads and Meta Ads campaigns for 3 skincare brands with a monthly budget of Rs 12 lakh. |
| N01 | bullet | one_unsupported | reverted | yes | Cut cost per acquisition from Rs 640 to Rs 410 by restructuring ad sets and testing 25 creatives. |
| N01 | bullet | verb_swap | reverted | yes | Built weekly ROAS reports in Google Analytics and Excel for the founders. |
| N01 | bullet | fabricated | reverted | yes | Wrote 40 SEO blog posts and grew organic sessions from 8,000 to 21,000 a month. |
| N02 | summary | tailored | kept | yes | Finance Executive with 5+ years of professional experience in month-end close, GST and Ind AS reporting, seeking the Financial Analyst (FP&A) role. |
| N02 | summary | fabricated | dropped | yes | — |
| N02 | bullet | faithful | kept | yes | Owned the month-end close for 2 plants, cutting close time from 9 days to 6 days. |
| N02 | bullet | one_unsupported | reverted | yes | Reconciled 14 bank accounts and vendor ledgers in SAP FICO every month. |
| N02 | bullet | fabricated | reverted | yes | Prepared GST returns and supported the Ind AS financial statements audit. |
| N02 | bullet | truthful_unscoped | reverted | yes | Audited 11 mid-size manufacturing clients under statutory audit engagements. |
| N03 | summary | tailored | kept | yes | HR Recruiter with 3+ years of professional experience hiring for technology and operations roles, seeking the Talent Acquisition Specialist role. |
| N03 | summary | one_unsupported | dropped | yes | — |
| N03 | bullet | tailored | kept | yes | Closed 85 tech and operations hires in 2024 with an average time-to-hire of 28 days. |
| N03 | bullet | one_unsupported | reverted | yes | Sourced candidates on Naukri and LinkedIn Recruiter and screened 60 profiles a week. |
| N03 | bullet | fabricated | reverted | yes | Coordinated onboarding for 120 new joiners with the payroll team. |
| N04 | summary | tailored | kept | yes | Inside Sales Executive with 2+ years of professional experience selling SaaS subscriptions to SMBs, seeking the Account Executive (Mid-Market) role. |
| N04 | summary | one_unsupported | dropped | yes | — |
| N04 | bullet | faithful | kept | yes | Achieved 118% of the annual quota in 2025, closing Rs 96 lakh in new SaaS subscriptions. |
| N04 | bullet | truthful_unscoped | reverted | yes | Made 60 cold calls a day and qualified leads in Salesforce for 2 account executives. |
| N04 | bullet | one_unsupported | reverted | yes | Negotiated renewal discounts with 30 SMB customers. |
| N04 | bullet | fabricated | reverted | yes | Sold 210 broadband connections door to door in Pune. |
| N05 | summary | tailored | kept | yes | Operations Executive with 4+ years of professional experience running inbound and dispatch for an FMCG distributor, seeking the Operations Manager - Fulfilment role. |
| N05 | summary | fabricated | dropped | yes | — |
| N05 | bullet | tailored | kept | yes | Supervised 18 pickers and loaders across 2 shifts. |
| N05 | bullet | one_unsupported | reverted | yes | Reduced dispatch errors from 3.2% to 0.9% by introducing barcode scanning at packing. |
| N05 | bullet | fabricated | reverted | yes | Ran monthly cycle counts in SAP MM for 4,500 SKUs. |
| N05 | bullet | faithful | kept | yes | Negotiated freight rates with 6 transport vendors, saving Rs 18 lakh a year. |
| N06 | summary | tailored | kept | yes | Data Analyst with 2+ years of professional experience building Power BI dashboards with SQL, seeking the Business Analyst role. |
| N06 | summary | fabricated | dropped | yes | — |
| N06 | bullet | tailored | kept | yes | Built 12 Power BI dashboards for regional managers on sales and inventory. |
| N06 | bullet | one_unsupported | reverted | yes | Wrote SQL queries to automate a weekly margin report, saving 5 hours a week. |
| N06 | bullet | verb_swap | reverted | yes | Cleaned 3 years of POS data in Python and Pandas for a pricing study. |
| N06 | project | one_unsupported | reverted | yes | Python and Pandas analysis of 10,000 telecom customers identifying 4 churn drivers. |
| N07 | summary | tailored | kept | yes | Science Teacher with 6+ years of professional experience designing lesson plans and digital quizzes, seeking the Instructional Designer role. |
| N07 | summary | fabricated | dropped | yes | — |
| N07 | bullet | faithful | kept | yes | Taught physics and chemistry to 4 sections of Grade 9 and 10, about 160 students. |
| N07 | bullet | one_unsupported | reverted | yes | Designed 30 Google Classroom quizzes and lesson plans aligned to the CBSE syllabus. |
| N07 | bullet | fabricated | reverted | yes | Raised the Grade 10 science pass rate from 82% to 94% over 2 years. |
| N08 | summary | tailored | kept | yes | Customer Support Team Lead with 5+ years of professional experience supporting B2B payments merchants, seeking the Customer Success Manager role. |
| N08 | summary | one_unsupported | dropped | yes | — |
| N08 | bullet | faithful | kept | yes | Led a team of 9 support agents handling 2,400 tickets a month in Zendesk. |
| N08 | bullet | one_unsupported | reverted | yes | Raised CSAT from 82% to 91% by rewriting 35 help-centre articles and macros. |
| N08 | bullet | truthful_unscoped | reverted | yes | Handled escalations for 40 enterprise merchants within a 4-hour SLA. |
| N08 | bullet | fabricated | reverted | yes | Resolved 70 payment and settlement tickets a day by phone and email. |
| N09 | summary | tailored | kept | yes | Staff Nurse with 4+ years of professional experience in cardiology wards, seeking the Clinical Research Coordinator role. |
| N09 | summary | fabricated | dropped | yes | — |
| N09 | bullet | truthful_unscoped | reverted | yes | Cared for 6 to 8 cardiac patients per shift in a 30-bed ward. |
| N09 | bullet | one_unsupported | reverted | yes | Recorded vitals and medication in the electronic health record for every shift. |
| N09 | bullet | fabricated | dropped | yes | — |
| N10 | summary | tailored | kept | yes | B.Com graduate (2025) with an accounts internship in Tally Prime, seeking the Accounts Executive role. |
| N10 | summary | fabricated | dropped | yes | — |
| N10 | bullet | faithful | kept | yes | Entered 600 purchase and sales vouchers in Tally Prime. |
| N10 | bullet | one_unsupported | reverted | yes | Prepared 3 monthly bank reconciliation statements for the proprietor. |
| N10 | project | one_unsupported | reverted | yes | Excel workbook that tracks GST on 150 sample invoices and flags mismatches. |
| N11 | summary | tailored | dropped | yes | — |
| N11 | summary | fabricated | dropped | yes | — |
| N11 | bullet | one_unsupported | reverted | yes | Designed 20 social media creatives a week for 5 retail clients in Illustrator and Photoshop. |
| N11 | bullet | faithful | kept | yes | Created packaging for 12 snack products, from concept sketches to print-ready files. |
| N11 | bullet | one_unsupported | reverted | yes | Rebuilt a jewellery client's brand identity, including logo, typography and colour palette. |
| N11 | project | one_unsupported | reverted | yes | Figma prototype of a 6-screen bus pass app, tested with 8 classmates. |
| N12 | summary | tailored | kept | yes | Quality Engineer with 4+ years of professional experience in automotive component manufacturing, seeking the Quality Engineer role. |
| N12 | summary | one_unsupported | dropped | yes | — |
| N12 | bullet | tailored | kept | yes | Reduced customer complaints on brake housings from 14 to 4 a quarter using 8D root cause analysis. |
| N12 | bullet | one_unsupported | reverted | yes | Ran SPC on 3 machining lines in Minitab and flagged drifting processes to the shift supervisors. |
| N12 | bullet | one_unsupported | reverted | yes | Prepared PPAP files for 9 new parts for a two-wheeler customer. |

## Evaluator defects on the full resumes

- **N01** [advice_fidelity] growth_note says "3 of the 5 key requirements" but lists 4
- **N02** [advice_fidelity] growth_note says "2 of the 4 core requirements" but lists 3
- **N04** [advice_fidelity] growth_note says "3 of the 5 listed requirements" but lists 2
- **N08** [advice_fidelity] growth_note says "4 of the 5 requirements" but lists 3
- **N09** [seniority_calibration] no growth_note explaining the level gap
