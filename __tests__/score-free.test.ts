import { scoreFree } from "@/lib/score-free";

const RESUME = `Priya Sharma
priya.sharma@example.com | +91 98765 43210 | Bengaluru

Summary
Backend engineer with 3 years building scalable Node.js and TypeScript services on AWS. Strong systems thinker who ships on deadlines.

Experience
Acme Logistics, Bengaluru — Backend Engineer
Jun 2022 - Present
- Led migration of order pipeline to AWS Lambda, cutting infra cost by 38% in two quarters.
- Designed Node.js microservice handling 4.2M requests/day with p99 latency under 180ms.
- Built TypeScript SDK adopted by 7 internal teams; reduced onboarding time from 5 days to 1.

Skills
Node.js, TypeScript, AWS, PostgreSQL, Docker, Redis, Kafka, REST APIs

Education
Indian Institute of Technology, Madras
B.Tech Computer Science, 2022`;

const JD = `We're hiring a Backend Engineer to build TypeScript and Node.js services on AWS. You'll design REST APIs, work with PostgreSQL and Redis at scale, and own service reliability. Experience with Docker and Kafka is a plus. Strong systems thinking required. Bangalore-based role.`;

describe("scoreFree", () => {
  const result = scoreFree(RESUME, JD);

  it("returns a numeric ats_score between 0 and 100", () => {
    expect(typeof result.ats_score).toBe("number");
    expect(result.ats_score).toBeGreaterThanOrEqual(0);
    expect(result.ats_score).toBeLessThanOrEqual(100);
  });

  it("scores a well-matched resume in a reasonable mid-band", () => {
    // Real-world short fixtures land in the 50-70 band; we just want to be
    // sure it isn't trivially low.
    expect(result.ats_score).toBeGreaterThanOrEqual(50);
  });

  it("returns matched and missing keyword arrays", () => {
    expect(Array.isArray(result.matched_keywords)).toBe(true);
    expect(Array.isArray(result.missing_keywords)).toBe(true);
    expect(result.matched_keywords.length).toBeGreaterThan(0);
  });

  it("identifies skills present in both resume and JD", () => {
    const overlap = result.skills_overlap.map((s) => s.toLowerCase());
    expect(overlap).toEqual(expect.arrayContaining(["typescript"]));
  });

  it("returns structure_flags as an array", () => {
    expect(Array.isArray(result.structure_flags)).toBe(true);
  });

  it("includes a keyword_match_pct between 0 and 100", () => {
    expect(result.keyword_match_pct).toBeGreaterThanOrEqual(0);
    expect(result.keyword_match_pct).toBeLessThanOrEqual(100);
  });

  it("is deterministic: same input → same output", () => {
    const again = scoreFree(RESUME, JD);
    expect(again).toEqual(result);
  });

  it("flags weak-action-verbs when bullets are weak", () => {
    const weakResume = `Jane Doe
jane@example.com
Summary
Looking for a role.
Experience
Acme — Engineer
Jan 2023 - Present
- Responsible for various tasks across the team.
- Helped with deliveries.
- Worked on stuff.
Skills
JavaScript
Education
ABC University, 2022`;
    const out = scoreFree(weakResume, JD);
    expect(out.structure_flags).toEqual(expect.arrayContaining(["weak-action-verbs"]));
    expect(out.ats_score).toBeLessThan(result.ats_score);
  });
});
