// Tailoring retention and PDF readiness for live captures, and a comparison
// between two capture sets.
//
//   npx tsx evals/resume-quality/live-tailoring.ts --a live-final-2 --b live-final-3 --save results/live-compare
//
// Fidelity says nothing about value: a resume that is the candidate's own
// profile, verbatim, passes every fidelity gate. This measures what survives:
//   - final bullets that differ from every source bullet AND add nothing
//     unsupported (evaluator's independent check) = truthful tailoring;
//   - with a raw capture: what the guards did to each model rewrite
//     (kept / trimmed / reverted / dropped);
//   - whether the summary names the target role, or fell back to the
//     candidate's own summary;
//   - whether the final resume renders with the production PDF renderer
//     (lib/resume-pdf.ts) in every template, and on how many A4 pages.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderResumePdf, type ResumeJson } from "@/lib/resume-pdf";
import { usableSections } from "@/lib/profile-completeness";
import { postProcessResume } from "@/lib/resume-generation";
import { evaluateResume, addedWords, wordSet, NEUTRAL, type ProfileFixture, type JdFixture, type Scenario, type GeneratedResume } from "./evaluate";

const ROOT = join(process.cwd(), "evals", "resume-quality");
const TEMPLATES = ["classic", "modern", "compact", "executive"] as const;

const words = (t: string) => (t ?? "").toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2);
const subsetOf = (a: string[], b: string[]) => { const s = new Set(b); return a.every((w) => s.has(w)); };
const sentences = (t: string) => (t ?? "").trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type TailoringReport = {
  bullets_final: number;
  bullets_verbatim_source: number;
  bullets_tailored_clean: number;
  bullets_tailored_unclean: number;
  /** Project descriptions: same three buckets. */
  projects: { final: number; verbatim: number; tailored_clean: number; unclean: number };
  raw?: { rewritten: number; rewritten_clean: number; kept: number; trimmed: number; reverted: number; dropped: number };
  summary_names_target: boolean;
  summary_uses_own_summary: boolean;
  raw_summary?: { sentences: number; kept: number; trimmed: number; dropped: number };
};

export function tailoringReport(up: ProfileFixture["user_profile"], jdTitle: string, final: GeneratedResume, raw?: GeneratedResume | null): TailoringReport {
  const exp = up.experience ?? [];
  const srcOf = (e: { company?: string; role?: string }) =>
    exp.find((p) => norm(p.company) === norm(e.company) && norm(p.role) === norm(e.role)) ?? exp.find((p) => norm(p.company) === norm(e.company));
  const scopeOf = (p: (typeof exp)[number]) => wordSet([p.role, p.company, ...p.bullets].join(" "));

  let finalN = 0, verbatim = 0, clean = 0, unclean = 0;
  for (const e of final.experience ?? []) {
    const src = srcOf(e);
    for (const b of e.bullets ?? []) {
      finalN++;
      if (src?.bullets.includes(b)) { verbatim++; continue; }
      if (src && addedWords(b, scopeOf(src), NEUTRAL).length === 0) clean++; else unclean++;
    }
  }

  const projects = { final: 0, verbatim: 0, tailored_clean: 0, unclean: 0 };
  for (const pr of final.projects ?? []) {
    const src = (up.projects ?? []).find((p) => { const a = norm(p.name), b = norm(pr.name); return a === b || a.startsWith(b) || b.startsWith(a); });
    if (!src || typeof pr.description !== "string") continue;
    projects.final++;
    if (pr.description === src.description) projects.verbatim++;
    else if (addedWords(pr.description, wordSet([src.name, src.description, ...src.tech].join(" ")), NEUTRAL).length === 0) projects.tailored_clean++;
    else projects.unclean++;
  }

  let rawStats: TailoringReport["raw"];
  if (raw) {
    rawStats = { rewritten: 0, rewritten_clean: 0, kept: 0, trimmed: 0, reverted: 0, dropped: 0 };
    for (const e of raw.experience ?? []) {
      const src = srcOf(e);
      if (!src) continue;
      const fe = (final.experience ?? []).find((x) => norm(x.company) === norm(e.company) && norm(x.role) === norm(e.role));
      const finals = fe?.bullets ?? [];
      for (const r of e.bullets ?? []) {
        if (src.bullets.includes(r)) continue;
        rawStats.rewritten++;
        if (addedWords(r, scopeOf(src), NEUTRAL).length === 0) rawStats.rewritten_clean++;
        const rw = words(r);
        if (finals.includes(r)) rawStats.kept++;
        // Trimmed: a final, non-source bullet made only of the rewrite's words
        // (its first word may be the source's verb).
        else if (finals.some((f) => !src.bullets.includes(f) && subsetOf(words(f).slice(1), rw))) rawStats.trimmed++;
        else {
          const best = [...src.bullets].sort((a, b) => words(b).filter((w) => rw.includes(w)).length - words(a).filter((w) => rw.includes(w)).length)[0];
          if (best && finals.includes(best)) rawStats.reverted++; else rawStats.dropped++;
        }
      }
    }
  }

  const summary = final.summary ?? "";
  const own = sentences(up.summary ?? "");
  let rawSummary: TailoringReport["raw_summary"];
  if (raw?.summary) {
    const finals = sentences(summary);
    rawSummary = { sentences: 0, kept: 0, trimmed: 0, dropped: 0 };
    for (const s of sentences(raw.summary)) {
      rawSummary.sentences++;
      if (finals.includes(s)) rawSummary.kept++;
      else if (finals.some((f) => !own.includes(f) && words(f).length >= 3 && subsetOf(words(f), words(s)))) rawSummary.trimmed++;
      else rawSummary.dropped++;
    }
  }

  return {
    bullets_final: finalN,
    bullets_verbatim_source: verbatim,
    bullets_tailored_clean: clean,
    bullets_tailored_unclean: unclean,
    projects,
    raw: rawStats,
    summary_names_target: summary.toLowerCase().includes(jdTitle.split(",")[0].trim().toLowerCase()),
    summary_uses_own_summary: own.some((s) => summary.includes(s)),
    raw_summary: rawSummary,
  };
}

export type PdfReport = { ok: boolean; pages: Record<string, number>; error?: string };

/** Render with the production renderer in every template; count A4 pages. */
export async function pdfReport(final: GeneratedResume, contact: { full_name?: string; email?: string }): Promise<PdfReport> {
  const pages: Record<string, number> = {};
  try {
    for (const t of TEMPLATES) {
      const bytes = await renderResumePdf(final as unknown as ResumeJson, contact, t);
      pages[t] = (await PDFDocument.load(bytes)).getPageCount();
    }
    return { ok: true, pages };
  } catch (e) {
    return { ok: false, pages, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── CLI: compare two capture sets ─────────────────────────────────────────

type Capture = { scenario: string; sha256: string; final_resume: GeneratedResume; raw_resume?: GeneratedResume | null; [k: string]: unknown };

function readCaptures(label: string): Map<string, Capture> {
  const dir = join(ROOT, "captured", label);
  const out = new Map<string, Capture>();
  for (const f of readdirSync(dir).filter((x) => /^S\d+\.json$/.test(x))) {
    const cap = JSON.parse(readFileSync(join(dir, f), "utf8")) as Capture;
    const { sha256, ...body } = cap;
    if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== sha256) throw new Error(`${label}/${f}: checksum mismatch`);
    out.set(cap.scenario, cap);
  }
  return out;
}

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const labels = [arg("--a") ?? "live-final-2", arg("--b") ?? "live-final-3"].filter((l) => existsSync(join(ROOT, "captured", l)));
  const replay = (arg("--replay") ?? "").split(",").filter(Boolean);
  const profiles = new Map(readdirSync(join(ROOT, "fixtures/profiles")).map((f) => { const p = JSON.parse(readFileSync(join(ROOT, "fixtures/profiles", f), "utf8")) as ProfileFixture; return [p.id, p]; }));
  const jds = new Map(readdirSync(join(ROOT, "fixtures/jds")).map((f) => { const j = JSON.parse(readFileSync(join(ROOT, "fixtures/jds", f), "utf8")) as JdFixture; return [j.id, j]; }));
  const { scenarios } = JSON.parse(readFileSync(join(ROOT, "scenarios.json"), "utf8")) as { scenarios: Scenario[] };

  const rows: Record<string, unknown>[] = [];
  const L: string[] = [`# Live tailoring and PDF readiness — ${labels.join(" vs ")}`, ""];
  const gateNames = ["factual_fidelity", "detail_fidelity", "summary_framing", "advice_fidelity", "seniority_calibration"];
  L.push(`| Scenario | Set | ${gateNames.join(" | ")} | final bullets | verbatim source | tailored (clean) | projects verbatim / tailored-clean | raw rewrites: kept / trimmed / reverted / dropped | summary names role | uses own summary | PDF pages (classic/modern/compact/executive) |`);
  L.push(`|---|---|${gateNames.map(() => "---").join("|")}|---|---|---|---|---|---|---|---|`);
  for (const s of scenarios) {
    const profile = structuredClone(profiles.get(s.profile)!);
    Object.assign(profile.user_profile, usableSections(profile.user_profile));
    const jd = jds.get(s.jd)!;
    const now = new Date(`${profile.facts_as_of}T12:00:00Z`);
    for (const label of labels) {
      const stored = readCaptures(label).get(s.id);
      if (!stored) continue;
      // --replay: re-run today's post-processing over the captured RAW reply.
      const cap = replay.includes(label) && stored.raw_resume
        ? { ...stored, final_resume: postProcessResume(structuredClone(stored.raw_resume), profile.user_profile, { now }).resume as GeneratedResume }
        : stored;
      const ev = evaluateResume(profile, jd, s, cap.final_resume, now);
      const g = Object.fromEntries(ev.gates.map((x) => [x.gate, x.pass]));
      const t = tailoringReport(profile.user_profile, jd.title, cap.final_resume, cap.raw_resume ?? null);
      const pdf = await pdfReport(cap.final_resume, { full_name: profile.user_profile.full_name, email: profile.user_profile.email });
      rows.push({ scenario: s.id, set: label, gates: g, defects: ev.gates.flatMap((x) => x.defects.map((d) => `[${x.gate}] ${d}`)), tailoring: t, pdf });
      const raw = t.raw ? `${t.raw.kept} / ${t.raw.trimmed} / ${t.raw.reverted} / ${t.raw.dropped} (of ${t.raw.rewritten}, ${t.raw.rewritten_clean} clean)` : "n/a (not captured)";
      const pages = pdf.ok ? TEMPLATES.map((x) => pdf.pages[x]).join("/") : `**FAIL: ${pdf.error}**`;
      L.push(`| ${s.id} | ${label} | ${gateNames.map((x) => (g[x] ? "PASS" : "FAIL")).join(" | ")} | ${t.bullets_final} | ${t.bullets_verbatim_source} | ${t.bullets_tailored_clean}${t.bullets_tailored_unclean ? ` (+${t.bullets_tailored_unclean} unclean)` : ""} | ${t.projects.verbatim} / ${t.projects.tailored_clean}${t.projects.unclean ? ` (+${t.projects.unclean} unclean)` : ""} | ${raw} | ${t.summary_names_target ? "yes" : "no"} | ${t.summary_uses_own_summary ? "yes" : "no"} | ${pages} |`);
    }
  }
  L.push("", "## Totals", "");
  for (const label of labels) {
    const rs = rows.filter((r) => r.set === label) as { gates: Record<string, boolean>; tailoring: TailoringReport; pdf: PdfReport }[];
    const sum = (f: (r: (typeof rs)[number]) => number) => rs.reduce((n, r) => n + f(r), 0);
    L.push(`- **${label}** (${rs.length} scenarios): ${gateNames.map((x) => `${x} ${rs.filter((r) => r.gates[x]).length}`).join(", ")}; ` +
      `bullets ${sum((r) => r.tailoring.bullets_final)} = verbatim ${sum((r) => r.tailoring.bullets_verbatim_source)} + tailored-clean ${sum((r) => r.tailoring.bullets_tailored_clean)} + unclean ${sum((r) => r.tailoring.bullets_tailored_unclean)}; ` +
      `projects ${sum((r) => r.tailoring.projects.final)} = verbatim ${sum((r) => r.tailoring.projects.verbatim)} + tailored-clean ${sum((r) => r.tailoring.projects.tailored_clean)} + unclean ${sum((r) => r.tailoring.projects.unclean)}; ` +
      `summary names role ${rs.filter((r) => r.tailoring.summary_names_target).length}, uses own summary ${rs.filter((r) => r.tailoring.summary_uses_own_summary).length}; ` +
      `PDF renders ${rs.filter((r) => r.pdf.ok).length}, one page in every template ${rs.filter((r) => r.pdf.ok && Object.values(r.pdf.pages).every((p) => p === 1)).length}` +
      (rs.some((r) => r.tailoring.raw) ? `; raw rewrites ${sum((r) => r.tailoring.raw?.rewritten ?? 0)} (clean ${sum((r) => r.tailoring.raw?.rewritten_clean ?? 0)}): kept ${sum((r) => r.tailoring.raw?.kept ?? 0)}, trimmed ${sum((r) => r.tailoring.raw?.trimmed ?? 0)}, reverted ${sum((r) => r.tailoring.raw?.reverted ?? 0)}, dropped ${sum((r) => r.tailoring.raw?.dropped ?? 0)}` : ""));
  }
  const md = L.join("\n") + "\n";
  console.log(md);
  const save = arg("--save");
  if (save) {
    const base = join(ROOT, save);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.md`, md);
    writeFileSync(`${base}.json`, JSON.stringify({ labels, rows }, null, 2) + "\n");
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
