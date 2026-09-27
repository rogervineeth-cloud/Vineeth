/**
 * Release blocker (supervised manual QA): from /create?step=template loaded
 * directly (reload or pasted URL), the stepper's visible Job Desc link
 * (<a href="/create">) did not navigate — neither a real nor a programmatic
 * click. Reproduced in Chromium: the Next <Link> navigation to the Job Desc
 * step was a no-op after a direct load of a later step (no request, no history
 * entry), while a shallow history.pushState switched the step reliably.
 *
 * Fix: for /create → /create step links, the stepper handles a plain left
 * click in-page with history.pushState (as the page's own step buttons do);
 * the page follows ?step=. The href stays for keyboard use and new tabs.
 *
 * The browser test at the end drives a real Chromium against a running build
 * and runs only when E2E_BASE_URL is set (see its comment).
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { createStepHref, handleStepClickInPage, type StepClick } from "@/lib/create-steps";

const STEPPER = fs.readFileSync(path.join(__dirname, "..", "components", "nav", "GlobalStepper.tsx"), "utf8");
const plain: StepClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

describe("stepper Job Desc from Template: handled in-page", () => {
  it("a plain left click on /create is handled in-page", () => {
    expect(handleStepClickInPage(plain, "/create")).toBe(true);
  });

  it.each([
    ["middle click", { button: 1 }], ["cmd-click", { metaKey: true }], ["ctrl-click", { ctrlKey: true }],
    ["shift-click", { shiftKey: true }], ["alt-click", { altKey: true }], ["already handled", { defaultPrevented: true }],
  ])("%s keeps the browser default (new tab/window etc.)", (_l, over) => {
    expect(handleStepClickInPage({ ...plain, ...over }, "/create")).toBe(false);
  });

  it("from another page (e.g. /profile) the normal Link navigation is used", () => {
    expect(handleStepClickInPage(plain, "/profile")).toBe(false);
  });

  it("the Job Desc href from Template keeps ?regen= and drops only the step", () => {
    expect(createStepHref("step=template", 1)).toBe("/create");
    expect(createStepHref("step=template&regen=dc25fa97-77a6-4ceb-9761-16429dccec2c", 1)).toBe("/create?regen=dc25fa97-77a6-4ceb-9761-16429dccec2c");
  });

  it("the stepper link pushes the href in-page for /create steps (and keeps a real href)", () => {
    const link = STEPPER.slice(STEPPER.indexOf("<Link\n                    href={href}"), STEPPER.indexOf("{inner}", STEPPER.indexOf("<Link\n                    href={href}")));
    expect(link).toMatch(/href=\{href\}/);
    expect(link).toMatch(/if \(step\.route === "\/create" && handleStepClickInPage\(e, pathname\)\) \{\s*e\.preventDefault\(\);\s*window\.history\.pushState\(null, "", href\);/);
  });
});

// ── Real browser (opt-in) ───────────────────────────────────────────────────
// Needs a running build and Playwright's Chromium. Example (local build with
// placeholder public Supabase settings; no real credentials):
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npx next build
//   ... npx next start -p 3100
//   E2E_BASE_URL=http://127.0.0.1:3100 E2E_SUPABASE_URL=http://127.0.0.1:54399 npx jest stepper-create-navigation
// The middleware only reads the session cookie (getSession, no network), so a
// locally forged, unsigned session gets past it; the Supabase URL is
// unreachable, so no real data is touched.
const BASE = process.env.E2E_BASE_URL;
const e2e = BASE ? describe : describe.skip;

e2e("browser: Template → Job Desc after a direct load of /create?step=template", () => {
  jest.setTimeout(90_000);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

  async function open(start: string) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: "11111111-1111-4111-8111-111111111111", email: "qa@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    const session = { access_token: [b64u({ alg: "HS256" }), b64u({ sub: user.id, exp, role: "authenticated", aud: "authenticated" }), "sig"].join("."), refresh_token: "r", expires_in: 3600, expires_at: exp, token_type: "bearer", user };
    const ref = new URL(process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54399").hostname.split(".")[0];
    const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: `sb-${ref}-auth-token`, value: "base64-" + b64u(session), url: BASE }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem("ndrs_jd", "Junior Data Analyst. ".repeat(20)));
    await page.goto(BASE + start, { waitUntil: "networkidle" });
    return { browser, page };
  }
  const heading = async (page: { locator(s: string): { allInnerTexts(): Promise<string[]> } }) => (await page.locator("h1,h2").allInnerTexts()).join(" | ");

  it.each([
    ["real click", "/create?step=template", "/create"],
    ["real click, regeneration", "/create?step=template&regen=dc25fa97-77a6-4ceb-9761-16429dccec2c", "/create?regen=dc25fa97-77a6-4ceb-9761-16429dccec2c"],
  ])("%s: URL and page switch to Job Desc", async (_l, start, expected) => {
    const { browser, page } = await open(start);
    try {
      expect(await heading(page)).toMatch(/Choose your template/);
      await page.locator("a", { hasText: "Job Desc" }).first().click();
      await page.waitForURL((u: URL) => u.pathname + u.search === expected, { timeout: 5000 });
      await page.waitForFunction(() => /Paste the job description/.test(document.body.innerText), null, { timeout: 5000 });
      expect(await page.locator('[aria-current="step"]').first().evaluate((el: Element) => el.parentElement?.textContent ?? "")).toMatch(/Job Desc/);
    } finally { await browser.close(); }
  });

  it("programmatic click (a.click()) also switches", async () => {
    const { browser, page } = await open("/create?step=template");
    try {
      await page.locator("a", { hasText: "Job Desc" }).first().evaluate((a: HTMLAnchorElement) => a.click());
      await page.waitForURL((u: URL) => u.pathname + u.search === "/create", { timeout: 5000 });
      await page.waitForFunction(() => /Paste the job description/.test(document.body.innerText), null, { timeout: 5000 });
    } finally { await browser.close(); }
  });
});
