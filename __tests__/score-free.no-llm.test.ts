// HARD INVARIANT: the Free-tier scoring path MUST NOT touch any LLM SDK.
//
// Strategy: walk the static `import` graph of lib/score-free.ts and
// app/api/score-free/route.ts and assert that no transitive file imports
// @anthropic-ai/sdk (or any other AI SDK we want to ban).
//
// We do this with regex on file contents — no module loader, no runtime
// resolution. That way we catch even files that have a banned import behind
// a code path the tests don't exercise.
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";

const ROOT = resolve(__dirname, "..");

// Match module specifiers in import/require statements only — not stray
// mentions in comments. Each entry must be of the form `from "<name>"` or
// `require("<name>")`.
const BANNED = [
  /from\s+["']@anthropic-ai\/sdk["']/,
  /require\(["']@anthropic-ai\/sdk["']\)/,
  /from\s+["']openai["']/,
  /require\(["']openai["']\)/,
  /from\s+["']ai["']/,           // vercel ai sdk
  /from\s+["']@ai-sdk\//,
];

const ENTRY_POINTS = [
  "lib/score-free.ts",
  "app/api/score-free/route.ts",
];

function resolveImport(spec: string, fromFile: string): string | null {
  // Map "@/x/y" → "<root>/x/y"
  let basePath: string;
  if (spec.startsWith("@/")) {
    basePath = join(ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    basePath = resolve(dirname(fromFile), spec);
  } else {
    return null; // bare/external import — skip walking it
  }

  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = basePath + ext;
    if (existsSync(p)) return p;
  }
  return null;
}

function walk(entry: string, visited: Set<string>): void {
  const abs = resolve(ROOT, entry);
  if (visited.has(abs)) return;
  visited.add(abs);
  if (!existsSync(abs)) return;

  const src = readFileSync(abs, "utf8");

  for (const re of BANNED) {
    if (re.test(src)) {
      throw new Error(
        `Banned import matched ${re} in ${abs} (reachable from a Free-tier entry point). ` +
        `The Free-tier scoring path must not depend on any LLM SDK.`
      );
    }
  }

  const importRe = /import[^"']*?["']([^"']+)["']|require\(["']([^"']+)["']\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    const next = resolveImport(spec, abs);
    if (next) walk(next, visited);
  }
}

describe("Free-tier scoring path import graph", () => {
  it.each(ENTRY_POINTS)("%s does not transitively import any LLM SDK", (entry) => {
    expect(() => walk(entry, new Set<string>())).not.toThrow();
  });
});
