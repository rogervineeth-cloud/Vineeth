/**
 * Two create-flow defects found in final manual QA:
 *
 * 1. Picking Executive / Modern / Compact at step 7 selected it visually, but
 *    navigating away and back reverted to Classic, and Review showed Classic.
 *    The click saved the choice to localStorage ("ndrs_template"); the page
 *    always started from useState("classic") and never read it back.
 *
 * 2. A skill chip added by hand on Job Desc did not appear in Review: Review
 *    listed jdAnalysis.keywords (auto-detected only, first 8), not the list
 *    the generation actually sends.
 *
 * Jest has no DOM here: the helpers are tested directly and the page wiring
 * by reading its source.
 */
import * as fs from "fs";
import * as path from "path";
import { storedTemplate, TEMPLATE_IDS, TEMPLATE_STORAGE_KEY } from "@/lib/templates";
import { effectiveJdKeywords } from "@/lib/jd-keywords";

const page = fs.readFileSync(path.join(__dirname, "..", "app", "(app)", "create", "page.tsx"), "utf8");

describe("template choice survives navigation", () => {
  it.each(["executive", "modern", "compact", "classic"])("a saved %s is restored", (id) => {
    expect(storedTemplate(id)).toBe(id);
  });

  it("missing or unknown values fall back to classic", () => {
    for (const raw of [null, undefined, "", "fancy", "Executive"]) expect(storedTemplate(raw)).toBe("classic");
  });

  it("covers every template the page offers and the server accepts", () => {
    const offered = [...page.matchAll(/^\s{4}id: "(\w+)",$/gm)].map((m) => m[1]).sort();
    expect(offered).toEqual([...TEMPLATE_IDS].sort());
    const route = fs.readFileSync(path.join(__dirname, "..", "app", "api", "generate-resume", "route.ts"), "utf8");
    for (const id of TEMPLATE_IDS) expect(route).toMatch(new RegExp(`"${id}"`));
  });

  it("the page starts from the saved choice and saves under the same key it reads", () => {
    expect(page).toMatch(/useState<TemplateId>\(\(\) =>\s*typeof window === "undefined" \? "classic" : storedTemplate\(localStorage\.getItem\(TEMPLATE_STORAGE_KEY\)\)/);
    expect(page).toMatch(/localStorage\.setItem\(TEMPLATE_STORAGE_KEY, tpl\.id\)/);
    expect(page).not.toMatch(/useState<TemplateId>\("classic"\)/);
    expect(TEMPLATE_STORAGE_KEY).toBe("ndrs_template"); // existing users' saved choice keeps working
  });

  it("Review shows the selected template and the request sends it", () => {
    expect(page).toMatch(/capitalize">\{selectedTemplate\}<\/p>/);
    expect(page).toMatch(/template: selectedTemplate,/);
  });
});

describe("hand-added skill chips reach Review", () => {
  const detected = ["SQL", "Python", "Excel", "Power BI", "Tableau", "Statistics", "ETL", "Dashboards", "Reporting"];

  it("keeps detected keywords the user did not remove, then the user's additions", () => {
    expect(effectiveJdKeywords(detected, new Set(["tableau"]), ["Looker", "dbt"]))
      .toEqual(["SQL", "Python", "Excel", "Power BI", "Statistics", "ETL", "Dashboards", "Reporting", "Looker", "dbt"]);
  });

  it("de-duplicates an addition that matches a detected keyword, case-insensitively", () => {
    expect(effectiveJdKeywords(["SQL"], new Set(), ["sql", "Looker"])).toEqual(["SQL", "Looker"]);
  });

  it("an addition the user typed that was also removed as detected still counts", () => {
    expect(effectiveJdKeywords(["SQL"], new Set(["sql"]), ["SQL"])).toEqual(["SQL"]);
  });

  it("the page sends and Review shows the same list, uncapped — so a chip added after 8 detected ones is visible", () => {
    expect(page).toMatch(/const effectiveKeywords = effectiveJdKeywords\(jdAnalysis\.keywords, removedKeywords, extraKeywords\);/);
    expect(page).toMatch(/jd_keywords: effectiveKeywords,/);
    const review = page.slice(page.indexOf("{/* STEP 3 — Review */}"), page.indexOf("{/* STEP 4"));
    expect(review).toMatch(/\{effectiveKeywords\.map\(\(kw\) => \(/);
    expect(review).not.toMatch(/jdAnalysis\.keywords/);
  });

  it("the template step's summary also uses the effective list", () => {
    const templateStep = page.slice(page.indexOf("Generating for"), page.indexOf("{/* STEP 3 — Review */}"));
    expect(templateStep).toMatch(/effectiveKeywords\.slice\(0, 5\)/);
    expect(templateStep).not.toMatch(/jdAnalysis\.keywords/);
  });
});
