// Development/test-only job source. Deterministic, offline, no network, no
// credentials. Every job points at example.com (a reserved domain) so a
// fixture job can never be mistaken for a real opening.
//
// It refuses to exist in production: the constructor and every search throw
// FixtureInProductionError, independently of the config check that should
// already have stopped it.
//
// JOB_RECOMMENDATIONS_FIXTURE_SCENARIO (dev/test only) exercises the UI states:
//   default  ... a normal result set
//   partial  ... provider reports an incomplete set, plus one invalid item
//   empty    ... no jobs
//   error    ... the provider fails

import { FixtureInProductionError, isProductionRuntime, type JobRecsEnv } from "@/lib/job-recs/config";
import type { JobProviderAdapter, ProviderResult } from "./types";

const J = (id: string, title: string, company: string, location: string | null, remote: boolean,
  skills: string[], min: number | null, max: number | null) => ({
  id, title, company, location, remote, skills, min_years: min, max_years: max,
  apply_url: `https://jobs.example.com/fixture/${id}`,
  posted_at: "2026-09-01T00:00:00Z",
});

export const FIXTURE_JOBS = [
  J("fx-001", "Frontend Engineer", "Fixture Labs", "Bengaluru", false, ["React", "TypeScript", "CSS", "Next.js"], 1, 4),
  J("fx-002", "Full Stack Developer", "Sample Systems", "Kochi", false, ["Node.js", "React", "SQL", "JavaScript"], 2, 5),
  J("fx-003", "Backend Engineer", "Example Fintech", null, true, ["Java", "Spring Boot", "SQL", "Kafka"], 3, 7),
  J("fx-004", "Data Analyst", "Demo Analytics", "Hyderabad", false, ["SQL", "Excel", "Python", "Power BI"], 0, 2),
  J("fx-005", "Software Engineer Intern", "Placeholder Tech", "Pune", false, ["Python", "Git"], null, null),
  J("fx-006", "Sales Manager", "Mock Distribution Co", "Kochi", false, ["Distribution Management", "Negotiation", "CRM"], 5, 10),
  J("fx-007", "DevOps Engineer", "Test Cloud", null, true, ["AWS", "Docker", "Kubernetes", "Terraform"], 2, 6),
  J("fx-008", "React Native Developer", "Fixture Mobile", "Chennai", false, ["React Native", "JavaScript", "TypeScript"], 1, 3),
  J("fx-009", "QA Engineer", "Sample Quality", "Bengaluru", false, ["Selenium", "Java", "Test Automation"], 1, 4),
  J("fx-010", "Business Development Executive", "Demo Ventures", "Thiruvananthapuram", false, ["Lead Generation", "CRM", "Negotiation"], 0, 3),
];

export class FixtureJobProvider implements JobProviderAdapter {
  readonly id = "fixture" as const;
  private scenario: string;

  constructor(private env: JobRecsEnv = process.env) {
    if (isProductionRuntime(env)) throw new FixtureInProductionError();
    this.scenario = (env.JOB_RECOMMENDATIONS_FIXTURE_SCENARIO ?? "default").toLowerCase();
  }

  // The fixture ignores the query and returns the same set every time, so
  // scoring alone decides the order.
  async search(): Promise<ProviderResult> {
    if (isProductionRuntime(this.env)) throw new FixtureInProductionError();
    switch (this.scenario) {
      case "empty":
        return { items: [] };
      case "error":
        throw new Error("fixture provider: simulated failure");
      case "partial":
        return {
          items: [
            ...FIXTURE_JOBS.slice(0, 4),
            { ...J("fx-bad", "Insecure Link Job", "Nope Inc", null, true, ["React"], null, null), apply_url: "http://jobs.example.com/insecure" },
          ],
          incomplete: true,
        };
      default:
        return { items: FIXTURE_JOBS.map((j) => ({ ...j })) };
    }
  }
}
