// Resume-quality eval runner.
//
//   npm run eval:resumes                # real model (needs ANTHROPIC_API_KEY)
//   npm run eval:resumes -- --offline   # payload + fixture checks only
//   ... -- --only S03,S10               # subset
//   ... -- --save results/after-offline # also write a committed summary
//   ... -- --captured live-before       # score responses captured from the
//                                       # preview runner (captured/<label>/)
//
// Runs the PRODUCTION generation path — lib/resume-generation.ts: the same
// SYSTEM_PROMPT, payload builder, Messages request (model, temperature,
// prefill), reply parser, sanitiser and normaliser that
// app/api/generate-resume/route.ts uses — with no auth, no credits and no
// database. This file must never import lib/plans or lib/supabase; a test
// enforces that.
//
// Outputs (gitignored): evals/resume-quality/out/<run-id>/
//   <scenario>.json   payload report, raw reply, final resume, evaluation
//   results.json      machine-readable matrix
//   results.md        human-readable matrix

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_RESUME_STANDARD } from "@/lib/models";
import { usableSections } from "@/lib/profile-completeness";
import { buildModelRequest, parseModelReply, postProcessResume } from "@/lib/resume-generation";
import {
  evaluatePayload,
  evaluateResume,
  type ProfileFixture,
  type JdFixture,
  type Scenario,
  type GeneratedResume,
  type PayloadReport,
  type ResumeReport,
} from "./evaluate";

const ROOT = join(process.cwd(), "evals", "resume-quality");

type Row = {
  scenario: string;
  profile: string;
  jd: string;
  expected_fit: string;
  jd_source: string;
  payload: {
    curated: number;
    truthful_but_marked_jd_only: string[];
    absent_but_marked_intersection: string[];
    curated_not_in_jd: string[];
    payload_recall_ceiling: number;
    must_inject_coverage: number;
    attainable_not_licensed: string[];
    pass: boolean;
  };
  model:
    | { status: "blocked"; reason: string }
    | { status: "error"; reason: string }
    | {
        status: "ok";
        ats_score: number | null;
        unsupported_claim_rate: number;
        keyword_precision: number;
        keyword_recall: number;
        gates: Record<string, boolean>;
        defects: string[];
        interview_chance: string;
        sanitiser_warnings: string[];
      };
};

function load<T>(dir: string): T[] {
  return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), "utf8")) as T);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function payloadPass(p: PayloadReport) {
  return (
    p.truthful_but_marked_jd_only.length === 0 &&
    p.absent_but_marked_intersection.length === 0 &&
    p.curated_not_in_jd.length === 0 &&
    p.must_inject_coverage >= 0.8
  );
}

async function generate(client: Anthropic, profile: ProfileFixture, report: PayloadReport) {
  const request = buildModelRequest(MODEL_RESUME_STANDARD, report.payload);
  const message = await client.messages.create(request);
  const parsed = parseModelReply(message);
  if (!parsed) return { error: "reply was not valid JSON", raw: message };
  const post = postProcessResume(parsed.json, profile.user_profile);
  return { raw: parsed.rawText, post };
}

function toMarkdown(rows: Row[], meta: Record<string, unknown>): string {
  const L: string[] = [];
  L.push(`# Resume-quality eval — ${meta.run_id}`, "");
  L.push(`- Mode: **${meta.mode}**  |  Model: \`${meta.model}\`  |  JD sources: ${meta.jd_sources}`, "");
  L.push("## Pre-model payload (what production would send)", "");
  L.push("| Scenario | Profile × JD | Fit | Curated | Truthful skill marked 'never claim' | Absent skill marked 'inject' | Curated not in JD | Must-inject coverage | Truthful requirements not licensed | Gate |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const p = r.payload;
    L.push(`| ${r.scenario} | ${r.profile} × ${r.jd} | ${r.expected_fit} | ${p.curated} | ${p.truthful_but_marked_jd_only.join(", ") || "-"} | ${p.absent_but_marked_intersection.join(", ") || "-"} | ${p.curated_not_in_jd.join(", ") || "-"} | ${p.must_inject_coverage} | ${p.attainable_not_licensed.join(", ") || "-"} | ${p.pass ? "PASS" : "FAIL"} |`);
  }
  L.push("", "## Generated resume", "");
  const gateNames = ["structural_validity", "factual_fidelity", "ats_keywords", "seniority_calibration", "section_completeness", "readability", "career_gap", "projects_vs_employment"];
  L.push(`| Scenario | ATS | Unsupported rate | KW precision | KW recall | ${gateNames.join(" | ")} | Interview chance |`);
  L.push(`|---|---|---|---|---|${gateNames.map(() => "---").join("|")}|---|`);
  for (const r of rows) {
    if (r.model.status !== "ok") {
      L.push(`| ${r.scenario} | ${r.model.status.toUpperCase()}: ${r.model.reason} |${" |".repeat(gateNames.length + 4)}`);
      continue;
    }
    const m = r.model;
    L.push(`| ${r.scenario} | ${m.ats_score} | ${m.unsupported_claim_rate} | ${m.keyword_precision} | ${m.keyword_recall} | ${gateNames.map((g) => (m.gates[g] ? "PASS" : "FAIL")).join(" | ")} | ${m.interview_chance} |`);
  }
  const defects = rows.flatMap((r) => (r.model.status === "ok" ? r.model.defects.map((d) => `- **${r.scenario}** ${d}`) : []));
  if (defects.length) L.push("", "### Defects", "", ...defects);
  return L.join("\n") + "\n";
}

async function main() {
  const profiles = new Map(load<ProfileFixture>("fixtures/profiles").map((p) => [p.id, p]));
  const jds = new Map(load<JdFixture>("fixtures/jds").map((j) => [j.id, j]));
  const { scenarios } = JSON.parse(readFileSync(join(ROOT, "scenarios.json"), "utf8")) as { scenarios: Scenario[] };
  const only = arg("--only")?.split(",");
  const selected = scenarios.filter((s) => !only || only.includes(s.id));

  const captured = arg("--captured");
  const key = process.env.ANTHROPIC_API_KEY;
  const offline = !captured && (process.argv.includes("--offline") || !key);
  const blockedReason = process.argv.includes("--offline") ? "offline run" : "ANTHROPIC_API_KEY not set";
  const client = offline || captured ? null : new Anthropic({ apiKey: key });

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(ROOT, "out", runId);
  mkdirSync(outDir, { recursive: true });

  const rows: Row[] = [];
  for (const s of selected) {
    const profile = structuredClone(profiles.get(s.profile)!);
    const jd = jds.get(s.jd)!;
    // Same filtering the route applies before the model sees the profile.
    Object.assign(profile.user_profile, usableSections(profile.user_profile));

    const pr = evaluatePayload(profile, jd);
    const row: Row = {
      scenario: s.id, profile: s.profile, jd: s.jd, expected_fit: s.expected_fit, jd_source: jd.source_status,
      payload: {
        curated: pr.curated_keywords.length,
        truthful_but_marked_jd_only: pr.truthful_but_marked_jd_only,
        absent_but_marked_intersection: pr.absent_but_marked_intersection,
        curated_not_in_jd: pr.curated_not_in_jd,
        payload_recall_ceiling: pr.payload_recall_ceiling,
        must_inject_coverage: pr.must_inject_coverage,
        attainable_not_licensed: pr.attainable_not_licensed,
        pass: payloadPass(pr),
      },
      model: { status: "blocked", reason: blockedReason },
    };

    let detail: Record<string, unknown> = { scenario: s, payload_report: pr };
    if (captured) {
      const file = join(ROOT, "captured", captured, `${s.id}.json`);
      if (!existsSync(file)) {
        row.model = { status: "blocked", reason: `no capture for ${s.id}` };
      } else {
        const cap = JSON.parse(readFileSync(file, "utf8"));
        const { sha256, ...body } = cap;
        const actual = createHash("sha256").update(JSON.stringify(body)).digest("hex");
        if (actual !== sha256) {
          row.model = { status: "error", reason: `capture checksum mismatch for ${s.id}` };
        } else if (!cap.parse_ok || !cap.final_resume) {
          row.model = { status: "error", reason: "model reply was not valid JSON" };
        } else {
          const ev = evaluateResume(profile, jd, s, cap.final_resume as GeneratedResume);
          row.model = {
            status: "ok",
            ats_score: ev.metrics.ats_score,
            unsupported_claim_rate: ev.metrics.unsupported_claim_rate,
            keyword_precision: ev.metrics.keyword_precision,
            keyword_recall: ev.metrics.keyword_recall,
            gates: Object.fromEntries(ev.gates.map((x) => [x.gate, x.pass])),
            defects: ev.gates.flatMap((x) => x.defects.map((d) => `[${x.gate}] ${d}`)),
            interview_chance: ev.interview_chance,
            sanitiser_warnings: cap.sanitiser_warnings,
          };
          // Structural validity: parsed, not truncated, nothing refused or repaired.
          const structural: string[] = [];
          if (cap.stop_reason !== "end_turn") structural.push(`stop_reason ${cap.stop_reason} (truncated?)`);
          if (cap.fatal?.length) structural.push(`production would refuse to save: ${cap.fatal.join(", ")}`);
          if (cap.repaired?.length) structural.push(`fields repaired by the normaliser: ${cap.repaired.join(", ")}`);
          row.model.gates.structural_validity = structural.length === 0;
          row.model.defects.push(...structural.map((d) => `[structural_validity] ${d}`));
          detail = { ...detail, capture: cap, evaluation: ev };
        }
      }
    } else if (client) {
      try {
        const g = await generate(client, profile, pr);
        if ("error" in g) {
          row.model = { status: "error", reason: g.error ?? "unknown" };
          detail = { ...detail, raw: g.raw };
        } else {
          const ev: ResumeReport = evaluateResume(profile, jd, s, g.post.resume as GeneratedResume);
          row.model = {
            status: "ok",
            ats_score: ev.metrics.ats_score,
            unsupported_claim_rate: ev.metrics.unsupported_claim_rate,
            keyword_precision: ev.metrics.keyword_precision,
            keyword_recall: ev.metrics.keyword_recall,
            gates: Object.fromEntries(ev.gates.map((x) => [x.gate, x.pass])),
            defects: ev.gates.flatMap((x) => x.defects.map((d) => `[${x.gate}] ${d}`)),
            interview_chance: ev.interview_chance,
            sanitiser_warnings: g.post.warnings,
          };
          row.model.gates.structural_validity = g.post.fatal.length === 0 && g.post.repaired.length === 0;
          if (g.post.fatal.length) row.model.defects.push(`[structural_validity] production would refuse to save: ${g.post.fatal.join(", ")}`);
          if (g.post.repaired.length) row.model.defects.push(`[structural_validity] fields repaired by the normaliser: ${g.post.repaired.join(", ")}`);
          detail = { ...detail, raw_reply: g.raw, final_resume: g.post.resume, sanitiser: g.post, evaluation: ev };
        }
      } catch (e) {
        row.model = { status: "error", reason: e instanceof Error ? e.message : String(e) };
      }
    }
    writeFileSync(join(outDir, `${s.id}.json`), JSON.stringify(detail, null, 2));
    rows.push(row);
    console.log(`${s.id} ${s.profile}×${s.jd} payload=${row.payload.pass ? "PASS" : "FAIL"} model=${row.model.status}`);
  }

  const meta = {
    run_id: runId,
    mode: captured ? `live model (captured from preview: ${captured})` : offline ? "offline (no model)" : "live model",
    model: MODEL_RESUME_STANDARD,
    jd_sources: [...new Set(rows.map((r) => r.jd_source))].join(", "),
  };
  const results = { meta, rows };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  const md = toMarkdown(rows, meta);
  writeFileSync(join(outDir, "results.md"), md);

  const save = arg("--save");
  if (save) {
    const base = join(ROOT, save);
    mkdirSync(dirname(base), { recursive: true });
    // Committed summaries carry no run-specific paths or raw model output.
    writeFileSync(`${base}.json`, JSON.stringify({ ...results, meta: { ...meta, run_id: save } }, null, 2) + "\n");
    writeFileSync(`${base}.md`, toMarkdown(rows, { ...meta, run_id: save }));
  }
  console.log(`\n${md}\nWrote ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
