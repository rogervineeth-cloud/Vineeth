/**
 * AI Job Recommendations Phase 1: flags, provider allowlist, profile
 * normalisation (explicit facts only), apply-link validation, provider
 * normalisation and deterministic v1 scoring. Offline; fixture data only.
 */
import {
  APPROVED_PROVIDERS, FixtureInProductionError, isJobRecsEnabled, isProductionRuntime, resolveProvider,
} from "@/lib/job-recs/config";
import { buildMatchingProfile, providerQuery, type MatchingProfile } from "@/lib/job-recs/profile";
import { validApplyUrl } from "@/lib/job-recs/apply-url";
import { normalizeBatch, normalizeJob, type NormalizedJob } from "@/lib/job-recs/providers/types";
import { FixtureJobProvider, FIXTURE_JOBS } from "@/lib/job-recs/providers/fixture";
import { createProvider } from "@/lib/job-recs/providers/registry";
import { rankJobs, scoreJob, SCORING_VERSION, WEIGHTS } from "@/lib/job-recs/scoring";

const NOW = new Date("2026-09-28T00:00:00Z");

describe("feature flag and provider selection", () => {
  it("is off by default and only 'true' turns it on", () => {
    expect(isJobRecsEnabled({})).toBe(false);
    for (const v of ["1", "yes", "TRUE", "on", ""]) expect(isJobRecsEnabled({ JOB_RECOMMENDATIONS_ENABLED: v })).toBe(false);
    expect(isJobRecsEnabled({ JOB_RECOMMENDATIONS_ENABLED: "true" })).toBe(true);
  });

  it("no provider, 'none' or an unapproved id resolves to unavailable", () => {
    for (const p of [undefined, "", "none", "indeed", "https://evil.example.com", "../fixture"]) {
      expect(resolveProvider({ JOB_RECOMMENDATIONS_PROVIDER: p, NODE_ENV: "development" })).toEqual({ status: "unavailable" });
    }
    expect(APPROVED_PROVIDERS).toEqual(["fixture"]);
  });

  it("production with no approved provider is the honest unavailable state", () => {
    expect(resolveProvider({ NODE_ENV: "production", VERCEL_ENV: "production" })).toEqual({ status: "unavailable" });
  });

  it("fixture is allowed in development and test", () => {
    expect(resolveProvider({ JOB_RECOMMENDATIONS_PROVIDER: "fixture", NODE_ENV: "development" })).toEqual({ status: "ready", provider: "fixture" });
    expect(resolveProvider({ JOB_RECOMMENDATIONS_PROVIDER: "fixture", NODE_ENV: "test" })).toEqual({ status: "ready", provider: "fixture" });
  });

  it("fixture hard-fails in production (config, constructor and search)", () => {
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production", NODE_ENV: "development" }]) {
      expect(isProductionRuntime(env)).toBe(true);
      expect(() => resolveProvider({ ...env, JOB_RECOMMENDATIONS_PROVIDER: "fixture" })).toThrow(FixtureInProductionError);
      expect(() => new FixtureJobProvider(env)).toThrow(FixtureInProductionError);
      expect(() => createProvider("fixture", env)).toThrow(FixtureInProductionError);
    }
    const env: Record<string, string> = { NODE_ENV: "test" };
    const p = new FixtureJobProvider(env);
    env.VERCEL_ENV = "production";
    return expect(p.search()).rejects.toThrow(FixtureInProductionError);
  });
});

describe("matching profile: explicit resume facts only", () => {
  const row = {
    target_roles: ["Frontend Engineer", "Other", ""],
    current_city: "Bengaluru",
    profile_data: {
      name: "Asha Example", email: "asha@example.com", phone: "+91 9876543210",
      graduation_year: 2021, summary: "Expert in Kubernetes and Rust.",
      experience: [
        { company: "Acme", role: "Software Engineer", duration: "Jul 2023 - Present", location: "Bengaluru", bullets: ["Built Kafka pipelines in Go"] },
      ],
      skills: ["reactjs", "TypeScript", "asha@example.com", "https://github.com/asha", "9876543210", "  CSS  ", "css"],
      projects: [{ name: "Site", description: "Used Docker", tech: ["Next.js"] }],
      education: [{ institution: "Some College", degree: "B.Tech", year: "2021" }],
    },
  };

  it("uses target roles, role titles, listed skills and project tech; canonicalises; dedupes", () => {
    const a = buildMatchingProfile(row, NOW);
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(a.profile.titles).toEqual(["Frontend Engineer", "Software Engineer"]);
    expect(a.profile.skills).toEqual(["React", "TypeScript", "CSS", "Next.js"]);
    expect(a.profile.professional_years).toBe(3.2);
    expect(a.profile.city).toBe("Bengaluru");
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never infers skills from bullets or summary, and drops contact-like terms", () => {
    const a = buildMatchingProfile(row, NOW);
    if (a.status !== "ok") throw new Error("expected ok");
    const all = JSON.stringify(a.profile);
    for (const s of ["Kafka", "Go", "Kubernetes", "Rust", "Docker", "asha", "9876543210", "github", "2021", "Acme", "Some College"]) {
      expect(all).not.toContain(s);
    }
  });

  it("the provider query carries titles and skills only", () => {
    const a = buildMatchingProfile(row, NOW);
    if (a.status !== "ok") throw new Error("expected ok");
    const q = providerQuery(a.profile);
    expect(Object.keys(q).sort()).toEqual(["skills", "titles"]);
    expect(JSON.stringify(q)).not.toContain("Bengaluru");
  });

  it("fingerprint is order-insensitive and changes when facts change", () => {
    const base = { target_roles: ["Analyst"], profile_data: { skills: ["SQL", "Excel"] } };
    const f1 = buildMatchingProfile(base, NOW);
    const f2 = buildMatchingProfile({ ...base, profile_data: { skills: ["excel", "sql"] } }, NOW);
    const f3 = buildMatchingProfile({ ...base, profile_data: { skills: ["SQL", "Python"] } }, NOW);
    if (f1.status !== "ok" || f2.status !== "ok" || f3.status !== "ok") throw new Error("expected ok");
    expect(f1.fingerprint).toBe(f2.fingerprint);
    expect(f1.fingerprint).not.toBe(f3.fingerprint);
  });

  it("reports insufficient resumes with what is missing", () => {
    expect(buildMatchingProfile(null)).toEqual({ status: "insufficient", missing: ["titles", "skills"] });
    expect(buildMatchingProfile({ target_roles: ["Analyst"], profile_data: { skills: ["SQL"] } })).toEqual({ status: "insufficient", missing: ["skills"] });
    expect(buildMatchingProfile({ target_roles: ["Other"], profile_data: { skills: ["SQL", "Excel"] } })).toEqual({ status: "insufficient", missing: ["titles"] });
    expect(buildMatchingProfile({ profile_data: { skills: "SQL, Excel", experience: "lots" } })).toEqual({ status: "insufficient", missing: ["titles", "skills"] });
  });
});

describe("apply links", () => {
  it("accepts https links to a public-looking host", () => {
    expect(validApplyUrl("https://jobs.example.com/apply/1?ref=x")).toBe("https://jobs.example.com/apply/1?ref=x");
  });
  it.each([
    "http://jobs.example.com/1", "javascript:alert(1)", "data:text/html,hi", "mailto:hr@example.com",
    "https://user:pw@jobs.example.com/", "https://localhost/apply", "https://127.0.0.1/apply", "https://[::1]/",
    "https://intranet/apply", "//jobs.example.com/x", "jobs.example.com", "", `https://example.com/${"a".repeat(2100)}`,
  ])("rejects unsafe link #%#", (u) => {
    expect(validApplyUrl(u)).toBeNull();
  });
});

describe("provider normalisation", () => {
  const good = { id: 7, title: " Data  Analyst ", company: "Demo", apply_url: "https://jobs.example.com/7", skills: ["SQL"],
    min_years: 1, max_years: 3, recruiter_email: "hr@example.com", raw_html: "<b>x</b>", candidate_notes: "secret" };

  it("keeps only the allowed fields", () => {
    const j = normalizeJob(good)!;
    expect(j).toEqual({ provider_job_id: "7", title: "Data Analyst", company: "Demo", location: null, remote: false,
      apply_url: "https://jobs.example.com/7", posted_at: null, required_skills: ["SQL"], min_years: 1, max_years: 3 });
    expect(JSON.stringify(j)).not.toMatch(/recruiter|raw_html|secret/);
  });

  it("drops non-https, malformed and duplicate jobs and counts them", () => {
    const b = normalizeBatch({ items: [good, { ...good }, { ...good, id: 8, apply_url: "http://jobs.example.com/8" },
      { id: 9 }, "junk", null, { ...good, id: 10, min_years: 5, max_years: 2 }] });
    expect(b.jobs.map((j) => j.provider_job_id)).toEqual(["7"]);
    expect(b.dropped).toBe(6);
    expect(b.incomplete).toBe(false);
  });

  it("fixture: default is complete; partial/empty/error scenarios behave", async () => {
    const d = normalizeBatch(await new FixtureJobProvider({ NODE_ENV: "test" }).search());
    expect(d.jobs).toHaveLength(FIXTURE_JOBS.length);
    expect(d.dropped).toBe(0);
    expect(d.jobs.every((j) => j.apply_url.startsWith("https://jobs.example.com/"))).toBe(true);
    const p = normalizeBatch(await new FixtureJobProvider({ NODE_ENV: "test", JOB_RECOMMENDATIONS_FIXTURE_SCENARIO: "partial" }).search());
    expect(p.incomplete).toBe(true);
    expect(p.dropped).toBe(1);
    const e = await new FixtureJobProvider({ NODE_ENV: "test", JOB_RECOMMENDATIONS_FIXTURE_SCENARIO: "empty" }).search();
    expect(e.items).toEqual([]);
    await expect(new FixtureJobProvider({ NODE_ENV: "test", JOB_RECOMMENDATIONS_FIXTURE_SCENARIO: "error" }).search()).rejects.toThrow();
  });
});

describe("v1 scoring", () => {
  const profile: MatchingProfile = { titles: ["Frontend Engineer"], skills: ["React", "TypeScript", "CSS"], professional_years: 2, city: "Bengaluru" };
  const job = (over: Partial<NormalizedJob>): NormalizedJob => ({
    provider_job_id: "j", title: "Frontend Engineer", company: "C", location: "Bengaluru", remote: false,
    apply_url: "https://jobs.example.com/j", posted_at: null, required_skills: ["React", "TypeScript", "CSS", "Next.js"],
    min_years: 1, max_years: 4, ...over,
  });

  it("weights sum to 1 and the version is v1", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(SCORING_VERSION).toBe("v1");
  });

  it("computes an exact, explained score", () => {
    const s = scoreJob(profile, job({}));
    // skills 3/4=.75*.5 + title 1*.3 + experience 1*.15 + location 1*.05 = .875
    expect(s.score).toBe(88);
    expect(s.components.skills).toMatchObject({ score: 0.75, matched: ["React", "TypeScript", "CSS"], missing: ["Next.js"] });
    expect(s.components.title.score).toBe(1);
    expect(s.components.experience.reason).toContain("fit");
    expect(s.components.location.reason).toContain("your city");
  });

  it("scores unknowns as a neutral 0.5 and says so", () => {
    const s = scoreJob(profile, job({ required_skills: [], min_years: null, max_years: null, location: null }));
    expect(s.components.skills.score).toBe(0.5);
    expect(s.components.experience.score).toBe(0.5);
    expect(s.components.location.score).toBe(0.5);
    expect(s.components.skills.reason).toMatch(/does not list/);
  });

  it("penalises under-experience, softly penalises over-experience, remote counts as local", () => {
    expect(scoreJob(profile, job({ min_years: 5, max_years: 8 })).components.experience.score).toBe(0);
    expect(scoreJob(profile, job({ min_years: 3, max_years: null })).components.experience.score).toBe(0.67);
    expect(scoreJob({ ...profile, professional_years: 12 }, job({})).components.experience.score).toBe(0.5);
    expect(scoreJob(profile, job({ remote: true, location: "Pune" })).components.location.score).toBe(1);
    expect(scoreJob(profile, job({ location: "Pune" })).components.location.score).toBe(0);
  });

  it("ranking is deterministic, filters irrelevant jobs and ties break by id", () => {
    const jobs = [
      job({ provider_job_id: "b" }), job({ provider_job_id: "a" }),
      job({ provider_job_id: "z", title: "Sales Manager", required_skills: ["CRM"] }),
    ];
    const r1 = rankJobs(profile, jobs).map((r) => r.job.provider_job_id);
    const r2 = rankJobs(profile, [...jobs].reverse()).map((r) => r.job.provider_job_id);
    expect(r1).toEqual(["a", "b"]);
    expect(r2).toEqual(r1);
  });

  it("the fixture set ranks a frontend profile's frontend jobs first", async () => {
    const b = normalizeBatch(await new FixtureJobProvider({ NODE_ENV: "test" }).search());
    const ranked = rankJobs(profile, b.jobs);
    expect(ranked[0].job.provider_job_id).toBe("fx-001");
    expect(ranked.map((r) => r.job.provider_job_id)).not.toContain("fx-006");
  });
});
