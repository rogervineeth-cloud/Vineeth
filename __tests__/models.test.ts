// Model IDs must be real. An inlined, non-existent ID
// ("claude-sonnet-4-5-20251101") shipped to production and broke resume
// generation 100% of the time — Anthropic returned 404 not_found_error and the
// route surfaced it as a generic "Something went wrong".
//
// This test pins every model reference to the set of IDs known to be valid, so
// a typo or a stale date-suffixed ID fails here instead of in production.
import {
  MODEL_RESUME_CREATOR,
  MODEL_RESUME_STANDARD,
  MODEL_LINKEDIN_REWRITE,
} from "@/lib/models";
import { readFileSync } from "fs";
import { resolve } from "path";

const VALID_MODEL_IDS = new Set([
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
]);

const ROOT = resolve(__dirname, "..");

describe("Claude model IDs", () => {
  it.each([
    ["MODEL_RESUME_CREATOR", MODEL_RESUME_CREATOR],
    ["MODEL_RESUME_STANDARD", MODEL_RESUME_STANDARD],
    ["MODEL_LINKEDIN_REWRITE", MODEL_LINKEDIN_REWRITE],
  ])("%s is a currently valid model id", (_name, id) => {
    expect(VALID_MODEL_IDS.has(id)).toBe(true);
  });

  it("no route hardcodes a model id outside lib/models.ts", () => {
    const routes = [
      "app/api/generate-resume/route.ts",
      "app/api/linkedin-rewrite/route.ts",
    ];
    for (const rel of routes) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      // Any "claude-..." string literal in a route is a hardcoded model id.
      const hardcoded = src.match(/["'`]claude-[a-z0-9.\-]+["'`]/gi) ?? [];
      expect({ file: rel, hardcoded }).toEqual({ file: rel, hardcoded: [] });
    }
  });
});
