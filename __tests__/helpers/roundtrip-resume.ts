/**
 * The shape of production resume 59c24878 (QA, 27 Oct 2026: synthetic
 * "Aarav" QA account, Compact style) whose own PDF did not import cleanly.
 * Fictional values with the same structure: employer + location on one row,
 * institution · grade + "City, State" on one row, a year RANGE, a grade
 * written "8.4 CGPA", and a quantified bullet long enough to wrap.
 */
import type { ContactDetails, ResumeJson } from "@/lib/resume-pdf";

export const ROUNDTRIP_CONTACT: ContactDetails = {
  full_name: "Aarav Menon", email: "aarav.qa@example.com", phone: "+91 98470 00000", current_city: "Chennai",
};

export const ROUNDTRIP_RESUME: ResumeJson = {
  section_order: ["summary", "experience", "skills", "education", "projects"],
  headline: "Associate Product Manager | User Research, SQL",
  summary: "Product analyst at Zoho Corporation who wrote user stories and owned the product spec for a billing flow.",
  experience: [{
    company: "Zoho Corporation", role: "Product Analyst", duration: "Jun 2025 - Present", location: "Chennai",
    bullets: [
      "Wrote user stories for the invoice reminders feature used by 12,000 businesses.",
      "Owned the product spec for the GST billing flow and shipped it in 6 weeks.",
      // Wraps onto a second line in every style (the round-trip must keep it one bullet).
      "Cut failed invoice reminders from 4.2% to 0.6% by moving retries to a queue, saving about Rs. 3.5 lakh a month across 12,000 businesses (3 regions).",
    ],
  }],
  skills: ["Product Management", "Stakeholder Communication", "SQL", "Jira"],
  education: [{
    institution: "College of Engineering Trivandrum", degree: "B.Tech Computer Science", year: "2022-2026",
    location: "Thiruvananthapuram, Kerala", cgpa: "8.4 CGPA",
  }],
  projects: [],
};
