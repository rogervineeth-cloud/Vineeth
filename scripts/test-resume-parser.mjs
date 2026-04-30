#!/usr/bin/env node
// Self-contained parser smoke test.
//
// Run with: `node scripts/test-resume-parser.mjs`
//
// Loads the TypeScript source via tsx if available, else compiles a quick CJS
// shim. We avoid pulling in a test runner so this runs anywhere `node` does and
// can live alongside the production build pipeline.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use tsx loader for TS imports.
try {
  register("tsx/esm", import.meta.url);
} catch {
  // tsx not installed — fall back to relying on the build output.
  // (In CI we run from the repo root with tsx available as a devDependency
  // shipped via npx.)
}

const { extractProfile, classifySection, splitInlineHeader, extractEmail, extractPhone, extractCity, findDateRange } =
  await import(resolve(__dirname, "../lib/resume-parser.ts"));

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failed++;
    failures.push({ name, detail });
    process.stdout.write(`  ✗ ${name}\n`);
    if (detail) process.stdout.write(`      ${detail}\n`);
  }
}

function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(name, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Section classification ───────────────────────────────────────────────
console.log("\nSection classification");
eq(classifySection("EXPERIENCE"), "experience", "ALL CAPS bare header");
eq(classifySection("Work Experience"), "experience", "Title Case header");
eq(classifySection("WORK EXPERIENCE:"), "experience", "trailing colon");
eq(classifySection("• Skills"), "skills", "leading bullet glyph");
eq(classifySection("Professional Summary"), "summary", "summary alias");
eq(classifySection("Career Objective"), "summary", "objective → summary");
eq(classifySection("Technical Skills"), "skills", "technical skills alias");
eq(classifySection("Tools & Technologies"), "skills", "ampersand variant");
eq(classifySection("Educational Qualifications"), "education", "Indian-style education alias");
eq(classifySection("Academic Projects"), "projects", "academic projects");
eq(classifySection("Certifications"), "certifications", "certifications");
eq(classifySection("Awards and Recognition"), "achievements", "awards → achievements");
eq(classifySection("Positions of Responsibility"), "achievements", "POR → achievements");
eq(classifySection("Random Heading"), null, "non-section header is null");
eq(classifySection(""), null, "empty header is null");
eq(classifySection("This is a long line that obviously is not a section header at all"), null, "long line is not a header");

// ── Inline header splitting ──────────────────────────────────────────────
console.log("\nInline header splitting");
eq(splitInlineHeader("Skills: Python, JavaScript, AWS"), { section: "skills", rest: "Python, JavaScript, AWS" }, "skills inline");
eq(splitInlineHeader("Summary - Senior engineer with 8 years"), { section: "summary", rest: "Senior engineer with 8 years" }, "summary with dash");
eq(splitInlineHeader("Hello world"), null, "no colon, no section");
eq(splitInlineHeader("Foo: bar"), null, "non-section prefix");

// ── Contact extractors ───────────────────────────────────────────────────
console.log("\nContact extractors");
eq(extractEmail("Reach me at jane.doe+work@example.co.in for details"), "jane.doe+work@example.co.in", "email with plus");
eq(extractEmail("no email here"), "", "no email");
eq(extractPhone("Phone: +91 98765 43210"), "+91 98765 43210", "Indian phone");
eq(extractPhone("Mobile: 9876543210"), "9876543210", "raw 10-digit");
eq(extractPhone("Call (415) 555-1234 anytime"), "(415) 555-1234", "US format");
eq(extractPhone("Year: 2024"), "", "rejects 4-digit year");
eq(extractCity("Located in Bengaluru, India"), "Bengaluru", "Bengaluru");
eq(extractCity("Address: New Delhi 110001"), "New Delhi", "multi-word city");
eq(extractCity("nowhere known"), "", "no city");

// ── Date range matcher ───────────────────────────────────────────────────
console.log("\nDate range matcher");
assert("Jan 2020 - Mar 2022", findDateRange("Jan 2020 - Mar 2022")?.toLowerCase().includes("jan"));
assert("Sept'19 – Present", findDateRange("Sept'19 – Present") !== null);
assert("01/2020 – 12/2022", findDateRange("01/2020 – 12/2022") !== null);
assert("2018 to 2020", findDateRange("2018 to 2020") !== null);
assert("Jun 2021 - Ongoing", findDateRange("Jun 2021 - Ongoing") !== null);
assert("2018 till date", findDateRange("2018 — Till date") !== null);
assert("plain text — no date", findDateRange("Worked on cloud infra") === null);

// ── Standard resume with explicit headers ────────────────────────────────
console.log("\nStandard resume layout");
const standardResume = `Rajesh Kumar
rajesh.kumar@gmail.com | +91 98765 43210 | Bengaluru, India

PROFESSIONAL SUMMARY
Senior backend engineer with 8 years of experience scaling distributed systems.

EXPERIENCE
Senior Software Engineer · Acme Corp           Jan 2020 – Present
Bengaluru, India
• Led migration of monolith to microservices, cutting p99 latency by 40%
• Mentored a team of 4 junior engineers
• Owned the payments pipeline (5M txns/day)

Software Engineer · StartCo                    Jul 2017 – Dec 2019
• Built the analytics ingest pipeline in Go
• Deployed Kubernetes clusters across 3 regions

EDUCATION
B.Tech in Computer Science                      2013 – 2017
Indian Institute of Technology, Madras
CGPA: 8.7/10

SKILLS
Python, Go, AWS, Kubernetes, Docker, PostgreSQL, Redis, Kafka

PROJECTS
Open Source Cache Library
A high-performance LRU cache implementation in Go
Tech: Go, Redis

CERTIFICATIONS
AWS Solutions Architect Professional
Google Cloud Professional Cloud Architect
`;
const std = extractProfile(standardResume);
assert("name extracted", std.name === "Rajesh Kumar", `got: ${std.name}`);
assert("email extracted", std.email === "rajesh.kumar@gmail.com", `got: ${std.email}`);
assert("phone extracted", std.phone.includes("98765"), `got: ${std.phone}`);
assert("city extracted", std.city === "Bengaluru", `got: ${std.city}`);
assert("summary extracted", (std.summary || "").includes("backend engineer"), `got: ${std.summary}`);
assert("two experience entries", std.experience.length === 2, `got: ${std.experience.length}`);
assert("first experience has bullets", std.experience[0]?.bullets.length >= 2, `got: ${std.experience[0]?.bullets.length}`);
assert("first experience has duration", std.experience[0]?.duration?.length > 0, `got: ${std.experience[0]?.duration}`);
assert("education entry present", std.education.length >= 1, `got: ${std.education.length}`);
assert("education has degree", /tech/i.test(std.education[0]?.degree || ""), `got: ${std.education[0]?.degree}`);
assert("graduation year extracted", std.graduation_year === 2017, `got: ${std.graduation_year}`);
assert("skills include Python", std.skills.includes("Python"), `got: ${JSON.stringify(std.skills)}`);
assert("skills include Kubernetes", std.skills.includes("Kubernetes"), `got: ${JSON.stringify(std.skills)}`);
assert("project extracted", std.projects.length >= 1, `got: ${std.projects.length}`);
assert("certifications extracted", std.certifications.length >= 1, `got: ${JSON.stringify(std.certifications)}`);

// ── Alternate section names (Indian fresher resume) ──────────────────────
console.log("\nAlternate section names — Indian fresher");
const fresherResume = `PRIYA SHARMA
Email: priya.sharma@email.com
Mobile: +91 9876543210
Address: Pune, Maharashtra

CAREER OBJECTIVE
Aspiring software engineer eager to apply problem-solving skills.

EDUCATIONAL QUALIFICATIONS
B.E. Computer Engineering
Pune Institute of Technology
2019 - 2023
Aggregate: 82%

HSC (Class XII)
Modern College, Pune
2019
Percentage: 88

ACADEMIC PROJECTS
Library Management System
Built a Django-based library management portal with role-based access.
Tech Stack: Python, Django, PostgreSQL

KEY SKILLS
Languages: Python, Java, JavaScript
Frameworks: Django, React
Databases: MySQL, PostgreSQL

POSITIONS OF RESPONSIBILITY
- Class Representative, 2021-22
- Tech Club Lead, 2022-23

EXTRA-CURRICULAR ACTIVITIES
- Won 2nd prize in HackPune 2022
- Speaker at Pune DevDay 2023
`;
const fresher = extractProfile(fresherResume);
assert("fresher name", fresher.name === "PRIYA SHARMA" || fresher.name === "Priya Sharma", `got: ${fresher.name}`);
assert("fresher email", fresher.email === "priya.sharma@email.com", `got: ${fresher.email}`);
assert("fresher phone has +91", fresher.phone.includes("9876543210") || fresher.phone.includes("98765"), `got: ${fresher.phone}`);
assert("fresher city Pune", fresher.city === "Pune", `got: ${fresher.city}`);
assert("fresher summary present", (fresher.summary || "").length > 10, `got: ${fresher.summary}`);
assert("fresher education entries", fresher.education.length >= 1, `got: ${fresher.education.length}`);
assert("fresher graduation 2023", fresher.graduation_year === 2023, `got: ${fresher.graduation_year}`);
assert("fresher skill Python", fresher.skills.some((s) => /python/i.test(s)), `got: ${JSON.stringify(fresher.skills)}`);
assert("fresher skill Django", fresher.skills.some((s) => /django/i.test(s)), `got: ${JSON.stringify(fresher.skills)}`);
assert("fresher projects", fresher.projects.length >= 1, `got: ${fresher.projects.length}`);
assert("fresher achievements", fresher.achievements.length >= 1, `got: ${JSON.stringify(fresher.achievements)}`);

// ── Inline header (no line break before content) ────────────────────────
console.log("\nInline-header layout");
const inlineResume = `John Doe
john@doe.io | 555-867-5309

Summary: 10 years building scalable systems.

Skills: Go, Rust, Python, Kafka, Postgres, Redis, AWS

Experience
Engineer at Foo Co (2020-2024)
• Did stuff
• Did more stuff
`;
const inline = extractProfile(inlineResume);
assert("inline name", inline.name === "John Doe", `got: ${inline.name}`);
assert("inline summary", (inline.summary || "").includes("10 years"), `got: ${inline.summary}`);
assert("inline skills Go", inline.skills.includes("Go"), `got: ${JSON.stringify(inline.skills)}`);
assert("inline skills Rust", inline.skills.includes("Rust"), `got: ${JSON.stringify(inline.skills)}`);
assert("inline experience present", inline.experience.length >= 1, `got: ${inline.experience.length}`);

// ── No explicit headers — fallback heuristics ────────────────────────────
console.log("\nNo-header fallback");
const noHeader = `Sam Smith
sam@example.com
+1 415 555 0123

Worked at Foo Inc, 2020 - 2023
• Did important things
• Shipped key features

Worked at Bar Inc, 2018 - 2020
• Built the platform
`;
const nh = extractProfile(noHeader);
assert("no-header name", nh.name === "Sam Smith", `got: ${nh.name}`);
assert("no-header email", nh.email === "sam@example.com", `got: ${nh.email}`);
assert("no-header phone", nh.phone.includes("555"), `got: ${nh.phone}`);
assert("no-header experience salvaged", nh.experience.length >= 1, `got: ${nh.experience.length}`);

// ── Empty / weird input ──────────────────────────────────────────────────
console.log("\nDegenerate inputs");
const empty = extractProfile("");
assert("empty input returns object", typeof empty === "object" && empty !== null);
assert("empty input has empty name", empty.name === "");
assert("empty input has empty arrays", Array.isArray(empty.experience) && empty.experience.length === 0);

const garbage = extractProfile("\n\n\n   \n\n");
assert("whitespace input ok", typeof garbage === "object" && garbage.name === "");

const justEmail = extractProfile("Contact: foo@bar.com");
assert("just-email extracts email", justEmail.email === "foo@bar.com");
assert("just-email derives name", justEmail.name === "Foo");

// ── Mixed-case / weird header decorations ────────────────────────────────
console.log("\nDecorated headers");
const decorated = `─── EXPERIENCE ───
Engineer · Foo (2020-2024)
• Built things

▪ Skills ▪
Java, Kotlin, Scala
`;
const dec = extractProfile(decorated);
assert("decorated experience", dec.experience.length >= 1, `got: ${dec.experience.length}`);
assert("decorated skills", dec.skills.length >= 2, `got: ${JSON.stringify(dec.skills)}`);

// ── Section without colon, all-caps with bullet glyph ────────────────────
const allCaps = `JOHN APPLESEED
john@apple.com

• PROFESSIONAL EXPERIENCE
Software Engineer at Apple                Jan 2018 – Dec 2022
- Shipped iOS frameworks
- Led perf reviews
`;
const ac = extractProfile(allCaps);
assert("all-caps experience header recognised", ac.experience.length >= 1, `got: ${ac.experience.length}`);
assert("all-caps experience has bullets", ac.experience[0]?.bullets.length >= 1, `got: ${ac.experience[0]?.bullets.length}`);

// ── Done ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
