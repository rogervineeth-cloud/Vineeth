/**
 * Fictional resumes covering the profile types the PDF styles must handle.
 * Shared by __tests__/ats-resume-styles.test.ts and the visual-QA script
 * (scripts/render-style-previews.ts). Every name, employer and number is
 * invented; text is WinAnsi-safe, as the download route makes it.
 */
import type { ContactDetails, ResumeJson } from "@/lib/resume-pdf";

export type Fixture = { id: string; label: string; contact: ContactDetails; resume: ResumeJson };

/** A final-year student: no work history, no section_order (fallback ordering). */
export const FRESHER: Fixture = {
  id: "fresher",
  label: "Fresher (no experience, no section_order)",
  contact: { full_name: "Ananya Krishnan", email: "ananya.k@example.com", phone: "+91 98470 12345", current_city: "Kochi" },
  resume: {
    headline: "B.Tech Computer Science graduate | Python, React, SQL",
    summary: "Computer Science graduate who built and deployed two full-stack projects used by classmates. Comfortable with Python, React and SQL, and keen to grow as a backend engineer.",
    experience: [],
    skills: ["Python", "JavaScript", "React", "Node.js", "PostgreSQL", "Git", "REST APIs", "Linux"],
    education: [
      { institution: "Model Engineering College", degree: "B.Tech, Computer Science and Engineering", year: "2022 - 2026", location: "Kochi", cgpa: "8.4" },
      { institution: "Govt. Higher Secondary School", degree: "Class XII (CBSE)", year: "2022", location: "Thrissur", cgpa: "92%" },
    ],
    projects: [
      { name: "Campus Bus Tracker", description: "Built a React and Node.js web app that shows live college bus locations. Used by about 300 students each day during the final semester.", tech: ["React", "Node.js", "PostgreSQL"] },
      { name: "Lecture Notes Search", description: "Indexed four years of shared lecture notes with a Python search service. Cut the time to find a topic from minutes to seconds.", tech: ["Python", "Flask", "SQLite"] },
    ],
  },
};

/** Four years at two employers, with the generator's experienced ordering. */
export const EXPERIENCED: Fixture = {
  id: "experienced",
  label: "Experienced (two roles, section_order given)",
  contact: { full_name: "Rahul Menon", email: "rahul.menon@example.com", phone: "+91 99610 54321", current_city: "Bengaluru" },
  resume: {
    section_order: ["summary", "experience", "skills", "education", "projects"],
    headline: "Backend Engineer | Java, Spring Boot, AWS",
    summary: "Backend engineer with four years building payment and order services in Java and Spring Boot. Led the move of a monolith to AWS services and owns on-call for two production systems.",
    experience: [
      {
        company: "Northwind Payments", role: "Software Engineer II", duration: "Mar 2023 - Present", location: "Bengaluru",
        bullets: [
          "Split the order monolith into four Spring Boot services on AWS ECS, cutting deploy time from 40 to 8 minutes.",
          "Added idempotency keys to the refund API, ending duplicate refunds that cost about Rs. 2 lakh a month.",
          "Mentored two new engineers through their first production releases.",
        ],
      },
      {
        company: "Lakeside Software", role: "Software Engineer", duration: "Jul 2021 - Feb 2023", location: "Kochi",
        bullets: [
          "Built REST APIs in Java for a logistics client handling 50,000 shipments a day.",
          "Wrote integration tests that raised coverage from 45% to 80% on the billing module.",
        ],
      },
    ],
    skills: ["Java", "Spring Boot", "AWS (ECS, SQS, RDS)", "PostgreSQL", "Kafka", "Docker", "JUnit", "Git"],
    education: [{ institution: "College of Engineering Trivandrum", degree: "B.Tech, Information Technology", year: "2017 - 2021", location: "Thiruvananthapuram", cgpa: "7.9" }],
    projects: [{ name: "Expense Splitter", description: "A small Spring Boot and React app to split shared trip costs. Open source with 40 stars.", tech: ["Spring Boot", "React"] }],
  },
};

const roles = [
  ["Engineering Manager", "Contoso Retail Tech", "Apr 2022 - Present", "Bengaluru"],
  ["Senior Software Engineer", "Fabrikam Logistics", "Jan 2019 - Mar 2022", "Pune"],
  ["Software Engineer", "Tailspin Systems", "Jun 2016 - Dec 2018", "Hyderabad"],
  ["Associate Engineer", "Wide World Importers", "Jul 2014 - May 2016", "Chennai"],
] as const;

/** Ten years, four roles: the candidate Compact is designed for. */
export const SENIOR: Fixture = {
  id: "senior",
  label: "Senior (four roles, dense)",
  contact: { full_name: "Priya Raghavan", email: "priya.raghavan@example.com", phone: "+91 98450 67890", current_city: "Bengaluru" },
  resume: {
    section_order: ["summary", "experience", "skills", "education", "projects"],
    headline: "Engineering Manager | Distributed Systems, Platform Engineering",
    summary: "Engineering manager with ten years in backend and platform engineering across retail and logistics. Leads a team of nine, owns a platform serving 30 million requests a day, and still reviews design and code every week.",
    experience: roles.map(([role, company, duration, location], i) => ({
      role, company, duration, location,
      bullets: [
        `Led delivery of a platform workstream at ${company} that reduced p95 latency by ${20 + i * 5}% across customer-facing services.`,
        `Designed and shipped services used by ${3 + i} product teams, with on-call runbooks and dashboards for each.`,
        `Cut infrastructure cost by ${10 + i * 3}% by right-sizing clusters and retiring unused environments.`,
        `Hired and mentored engineers; ${2 + i} were promoted during this period.`,
      ],
    })),
    skills: ["Go", "Java", "Kubernetes", "AWS", "Terraform", "PostgreSQL", "Kafka", "gRPC", "Observability", "System Design", "Hiring", "Mentoring"],
    education: [{ institution: "National Institute of Technology Calicut", degree: "B.Tech, Computer Science", year: "2010 - 2014", location: "Kozhikode", cgpa: "8.1" }],
    projects: [],
  },
};

/** More than any one page holds: must paginate, never clip. */
export const LONG: Fixture = {
  id: "long",
  label: "Long (eight roles, paginates)",
  contact: { full_name: "Vikram Iyer", email: "vikram.iyer@example.com", phone: "+91 90000 11111", current_city: "Mumbai" },
  resume: {
    section_order: ["summary", "experience", "skills", "education", "projects"],
    summary: SENIOR.resume.summary,
    experience: Array.from({ length: 8 }, (_, i) => ({
      role: `Role ${i + 1} Title`, company: `Employer ${i + 1} Pvt Ltd`, duration: `${2024 - i * 2} - ${2025 - i * 2}`, location: "Mumbai",
      bullets: Array.from({ length: 5 }, (_, j) => `Delivered outcome ${j + 1} for employer ${i + 1}, with a measurable improvement the team tracked every quarter.`),
    })),
    skills: SENIOR.resume.skills,
    education: SENIOR.resume.education,
    projects: EXPERIENCED.resume.projects,
  },
};

export const FIXTURES: Fixture[] = [FRESHER, EXPERIENCED, SENIOR, LONG];
