/**
 * Customer-facing credit copy must state exactly the enforced policy
 * (migration 018) and never contradict it:
 *   1. the first AI resume of a verified account is a free, VIEW-ONLY preview;
 *   2. every later Generate and every Regenerate costs 1 paid credit;
 *   3. spending 1 paid credit unlocks the free preview's PDF;
 *   4. resumes generated with paid credits download again at no extra credit.
 * The free ATS review is never called a "preview" (that word now means the
 * free AI resume).
 *
 * Release QA found "Every PDF download needs a paid credit" in the landing
 * FAQ while paid resumes re-download free; the same contradiction survived in
 * the Free Beta card, the /pricing notice and lib/plan-config.ts. This scans
 * every customer-facing file (code only, comments ignored) for it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  FREE_PREVIEW_RULE, FREE_BETA_LABEL, FREE_PREVIEW_USED_MESSAGE, VERIFY_EMAIL_FOR_FREE_MESSAGE,
  FREE_PREVIEW_DOWNLOAD_MESSAGE, BETA_EXHAUSTED_MESSAGE,
} from "@/lib/plan-config";
import { FREE_BETA_FEATURES } from "@/components/beta/FreeBetaCard";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) files(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}
// Every page/component, every API route (their JSON messages reach users), and the copy libs.
const CUSTOMER_FACING = [...files("app"), ...files("components"), "lib/plan-config.ts", "lib/pricing-display.ts"];

describe("no customer-facing copy contradicts the credit policy", () => {
  const banned: [RegExp, string][] = [
    [/every PDF download/i, "implies paid resumes are charged per download (they re-download free)"],
    [/PDF downloads?\s+(and [^."]*\s)?requires?\b/i, "generic 'PDF downloads require…' — only the free preview's PDF needs a credit"],
    [/PDF download requires a paid credit/i, "generic 'PDF download requires a paid credit' — say the free preview's PDF is unlocked with 1 paid credit"],
    [/free regenerat|regenerat\w*\s+(is|are)\s+free|free within 24/i, "regeneration is never free"],
    [/free ATS preview|ATS preview per account|run your free preview|used your free preview\b(?! —)/i, "the ATS review must not be called a preview"],
    [/3 free|3 AI-tailored resume generations/i, "stale 3-credit beta copy"],
  ];
  it.each(CUSTOMER_FACING)("%s", (f) => {
    const src = code(f);
    for (const [re, why] of banned) {
      const m = src.match(re);
      expect({ file: f, found: m?.[0] ?? null, why }).toEqual({ file: f, found: null, why });
    }
  });
});

describe("the policy is stated where customers decide", () => {
  it("the shared rule, label and messages say view-only / 1 paid credit per Generate or Regenerate / unlock with 1 paid credit", () => {
    expect(FREE_PREVIEW_RULE).toMatch(/first AI resume is a free, view-only preview/);
    expect(FREE_PREVIEW_RULE).toMatch(/Every later Generate or Regenerate costs 1 paid credit/);
    expect(FREE_PREVIEW_RULE).toMatch(/1 paid credit also unlocks the free preview's PDF/);
    expect(FREE_BETA_LABEL).toMatch(/view-only/);
    expect(FREE_PREVIEW_USED_MESSAGE).toMatch(/Each new Generate or Regenerate costs 1 paid credit, PDF included/);
    expect(BETA_EXHAUSTED_MESSAGE).toBe(FREE_PREVIEW_USED_MESSAGE);
    expect(VERIFY_EMAIL_FOR_FREE_MESSAGE).toMatch(/free, view-only AI resume preview/);
    expect(FREE_PREVIEW_DOWNLOAD_MESSAGE).toMatch(/Spend 1 paid credit to unlock its PDF — once; downloading again is free/);
  });

  it("the Free Beta card (landing + /pricing) states all four rules", () => {
    const all = FREE_BETA_FEATURES.join(" | ");
    expect(all).toMatch(/first AI-tailored resume free — a view-only preview/);
    expect(all).toMatch(/Every later Generate or Regenerate: 1 paid credit/);
    expect(all).toMatch(/Unlock the preview's PDF any time with 1 paid credit/);
    expect(all).toMatch(/Resumes made with paid credits download again at no extra credit/);
  });

  it("the landing FAQ states all four rules", () => {
    const landing = code("app/page.tsx");
    expect(landing).toMatch(/Your first AI-tailored resume \(verified accounts\) as a view-only preview/);
    expect(landing).toMatch(/Every AI resume after your free preview, including every regeneration, uses 1 paid credit/);
    expect(landing).toMatch(/To download the free preview, spend 1 paid credit once/);
    expect(landing).toMatch(/Resumes generated with a paid credit can be downloaded again any time at no extra cost/);
  });

  it("the /pricing notice states all four rules", () => {
    const pricing = code("app/pricing/PricingClient.tsx");
    expect(pricing).toMatch(/After your free, view-only preview, each Generate or Regenerate costs 1 paid credit, PDF included \(download it again at no extra credit\); 1 paid credit also unlocks the free preview&apos;s PDF\./);
  });

  it("in the app: preview offers the unlock and says re-downloads are free; profile says regenerating costs 1 paid credit", () => {
    const preview = code("app/(app)/preview/[id]/page.tsx");
    expect(preview).toMatch(/Use 1 paid credit to download/);
    expect(preview).toMatch(/Downloading again later is free\./);
    expect(code("app/(app)/profile/page.tsx")).toMatch(/Regenerating uses 1 paid credit\./);
  });

  it("the ATS review is called a review everywhere it is offered", () => {
    expect(code("app/page.tsx")).toMatch(/Free ATS review[\s\S]*1 free ATS review per account/);
    expect(code("app/pricing/PricingClient.tsx")).toMatch(/Free ATS review[\s\S]*1 free ATS review per account/);
    const review = code("app/free-review/FreeReviewClient.tsx");
    expect(review).toMatch(/Sign up to run your free ATS review/);
    expect(review).toMatch(/You&apos;ve used your free ATS review/);
    // Every remaining "preview" on that page is the AI resume preview.
    for (const m of review.matchAll(/[^\n]{0,40}\bpreview\b/gi)) expect(m[0]).toMatch(/resume (is free as a view-only )?preview|view-only AI resume preview|view-only preview/i);
  });
});
