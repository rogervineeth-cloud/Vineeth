/**
 * LinkedIn job-search companion (lib/linkedin-jobs.ts,
 * components/dashboard/LinkedinJobSearch.tsx).
 *
 * The contract:
 *   - the link always points at https://www.linkedin.com/jobs/search/ — user
 *     text only ever lands, encoded, in `keywords` / `location`;
 *   - it opens in a new tab with rel="noopener noreferrer nofollow";
 *   - nothing is fetched, scraped, ranked, stored or tracked: the component
 *     makes no request, touches no database or browser storage, and has no
 *     dependency on the (dormant) job-recommendations feature;
 *   - the copy says so, and offers /create for tailoring to a job found;
 *   - it lives on the signed-in dashboard (middleware protects /dashboard),
 *     not on the existing /dashboard/linkedin profile-rewrite route.
 */
import * as fs from "fs";
import * as path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

import { linkedinJobsSearchUrl, cleanSearchField, LINKEDIN_JOBS_SEARCH_URL, MAX_FIELD_CHARS, OUTBOUND_REL } from "@/lib/linkedin-jobs";
import LinkedinJobSearch, { LinkedinSearchLink, LINKEDIN_COMPANION_NOTICE } from "@/components/dashboard/LinkedinJobSearch";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("linkedinJobsSearchUrl", () => {
  const parse = (u: string | null) => {
    expect(u).not.toBeNull();
    return new URL(u!);
  };
  const expectFixedTarget = (url: URL) => {
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("www.linkedin.com");
    expect(url.pathname).toBe("/jobs/search/");
    expect(url.username + url.password + url.hash).toBe("");
    expect([...url.searchParams.keys()].every((k) => k === "keywords" || k === "location")).toBe(true);
  };

  it("role and location become the encoded keywords and location query values", () => {
    const u = linkedinJobsSearchUrl("Backend Engineer", "Bengaluru");
    expect(u).toBe("https://www.linkedin.com/jobs/search/?keywords=Backend+Engineer&location=Bengaluru");
    expectFixedTarget(parse(u));
  });

  it("location is optional; no role means no link", () => {
    expect(linkedinJobsSearchUrl("Data Analyst")).toBe("https://www.linkedin.com/jobs/search/?keywords=Data+Analyst");
    expect(linkedinJobsSearchUrl("Data Analyst", "   ")).toBe("https://www.linkedin.com/jobs/search/?keywords=Data+Analyst");
    for (const r of ["", "   ", "\n\t", null, undefined]) expect(linkedinJobsSearchUrl(r, "Pune")).toBeNull();
  });

  it.each([
    ["C++ & C# dev", "Kochi"],
    ["a&location=Evil", "x#frag"],
    ["https://evil.example/", "//evil.example"],
    ["javascript:alert(1)", "data:text/html,<script>"],
    ["../../../login?next=/", "@evil.example"],
    ["résumé 東京 ‮rtl", "São Paulo"],
    ["<img src=x onerror=alert(1)>", "\"'><"],
  ])("hostile or unusual input %p / %p cannot change the target and round-trips exactly", (role, location) => {
    const url = parse(linkedinJobsSearchUrl(role, location));
    expectFixedTarget(url);
    expect(url.searchParams.get("keywords")).toBe(cleanSearchField(role));
    expect(url.searchParams.get("location")).toBe(cleanSearchField(location));
    expect(url.toString().startsWith(LINKEDIN_JOBS_SEARCH_URL + "?keywords=")).toBe(true);
  });

  it("trims, single-spaces, strips control characters and caps each field", () => {
    expect(cleanSearchField("  Product\n\tManager\u0000 ")).toBe("Product Manager");
    const long = "x".repeat(500);
    const url = parse(linkedinJobsSearchUrl(long, long));
    expect(url.searchParams.get("keywords")).toHaveLength(MAX_FIELD_CHARS);
    expect(url.searchParams.get("location")).toHaveLength(MAX_FIELD_CHARS);
  });
});

describe("LinkedinSearchLink", () => {
  it("is a plain new-tab anchor with noopener noreferrer nofollow", () => {
    const href = linkedinJobsSearchUrl("QA Engineer", "Chennai")!;
    const html = renderToStaticMarkup(createElement(LinkedinSearchLink, { href }));
    expect(OUTBOUND_REL).toBe("noopener noreferrer nofollow");
    expect(html).toContain(`href="${href.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toMatch(/opens linkedin\.com in a new tab/);
    expect(html).not.toMatch(/onclick/i);
  });
});

describe("LinkedinJobSearch (dashboard component)", () => {
  const html = renderToStaticMarkup(createElement(LinkedinJobSearch));

  it("starts empty: labelled role and location inputs, no outbound link until a role is typed", () => {
    expect(html).toMatch(/<label[^>]*for="linkedin-jobs-role"[^>]*>Role<\/label>/);
    expect(html).toMatch(/<label[^>]*for="linkedin-jobs-location"[^>]*>Location/);
    expect(html).toMatch(/id="linkedin-jobs-role"[^>]*value=""/);
    expect(html).not.toContain("linkedin.com/jobs");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toMatch(/<form/);
  });

  it("says plainly that nothing is fetched, scraped, ranked or saved, and offers /create", () => {
    expect(LINKEDIN_COMPANION_NOTICE).toMatch(/opens LinkedIn's own job search in a new tab/);
    expect(LINKEDIN_COMPANION_NOTICE).toMatch(/doesn't fetch, scrape, rank or save LinkedIn listings/);
    expect(LINKEDIN_COMPANION_NOTICE).toMatch(/doesn't save the role or location you type here/);
    expect(html).toContain(LINKEDIN_COMPANION_NOTICE.replace(/'/g, "&#x27;"));
    expect(html).toMatch(/<a href="\/create"[^>]*>tailor your resume to it →<\/a>/);
    expect(html).toMatch(/Copy its job description/);
  });

  it("makes no request and touches no storage, database, analytics or job-recommendations code", () => {
    for (const f of ["components/dashboard/LinkedinJobSearch.tsx", "lib/linkedin-jobs.ts"]) {
      const src = read(f);
      expect({ f, hits: src.match(/\bfetch\(|XMLHttpRequest|sendBeacon|axios|localStorage|sessionStorage|indexedDB|document\.cookie|supabase|@\/lib\/analytics|\btrack\(|job-?recommend|jobRecommend|\/api\//gi) }).toEqual({ f, hits: null });
      const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      expect(imports.every((i) => ["react", "next/link", "lucide-react", "@/components/ui/input", "@/components/ui/label", "@/lib/linkedin-jobs"].includes(i))).toBe(true);
    }
  });
});

describe("placement", () => {
  it("renders on the signed-in dashboard, which the middleware protects", () => {
    const dashboard = read("app/(app)/dashboard/page.tsx");
    expect(dashboard).toMatch(/import LinkedinJobSearch from "@\/components\/dashboard\/LinkedinJobSearch";/);
    expect(dashboard).toMatch(/\{!loading && <LinkedinJobSearch \/>\}/);
    expect(read("lib/supabase/middleware.ts")).toMatch(/protectedPaths = \[[^\]]*"\/dashboard"/);
  });

  it("does not use or replace the existing /dashboard/linkedin profile-rewrite route", () => {
    const companion = read("components/dashboard/LinkedinJobSearch.tsx");
    expect(companion).not.toMatch(/dashboard\/linkedin|linkedin-rewrite|parse-linkedin/);
    expect(fs.existsSync(path.join(ROOT, "app", "(app)", "dashboard", "linkedin", "page.tsx"))).toBe(true);
  });
});
