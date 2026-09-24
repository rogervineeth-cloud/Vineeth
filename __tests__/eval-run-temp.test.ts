/**
 * TEMPORARY route guard tests — deleted together with
 * app/api/eval-run-temp/route.ts once the live eval is captured.
 */
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

jest.mock("@/lib/plans", () => { throw new Error("eval route imported lib/plans"); });
jest.mock("@/lib/supabase/server", () => { throw new Error("eval route imported lib/supabase/server"); });
jest.mock("@/lib/supabase/client", () => { throw new Error("eval route imported lib/supabase/client"); });

const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

import * as route from "@/app/api/eval-run-temp/route";
import { EXPIRES_AT } from "@/app/api/eval-run-temp/expiry";
import { SYSTEM_PROMPT } from "@/lib/resume-generation";
import { MODEL_RESUME_STANDARD } from "@/lib/models";

const TOKEN = "a".repeat(64);
const get = (qs: string) => route.GET(new NextRequest(`http://localhost/api/eval-run-temp?${qs}`));

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, VERCEL_ENV: "preview", EVAL_RUN_TOKEN: TOKEN, ANTHROPIC_API_KEY: "test-key-not-real" };
  mockCreate.mockReset();
});
afterAll(() => { process.env = ENV; });

describe("lockdown", () => {
  it("404 outside preview, even with the right token", async () => {
    for (const env of ["production", "development", undefined]) {
      process.env.VERCEL_ENV = env as string;
      expect((await get(`t=${TOKEN}&check=1`)).status).toBe(404);
    }
  });

  it("404 to everything after the hard expiry", async () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.parse(EXPIRES_AT) + 1);
    try {
      expect((await get(`t=${TOKEN}&check=1`)).status).toBe(404);
      expect((await get(`t=${TOKEN}&s=S01`)).status).toBe(404);
    } finally {
      spy.mockRestore();
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("expires within hours, not days", () => {
    const hours = (Date.parse(EXPIRES_AT) - Date.parse("2026-09-24T10:00:00Z")) / 3_600_000;
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThanOrEqual(3);
  });

  it("404 when no token is configured, or it is too short", async () => {
    delete process.env.EVAL_RUN_TOKEN;
    expect((await get(`t=&check=1`)).status).toBe(404);
    process.env.EVAL_RUN_TOKEN = "short";
    expect((await get(`t=short&check=1`)).status).toBe(404);
  });

  it("404 for a missing or wrong token", async () => {
    expect((await get(`check=1`)).status).toBe(404);
    expect((await get(`t=${"b".repeat(64)}&check=1`)).status).toBe(404);
    expect((await get(`t=${TOKEN}x&check=1`)).status).toBe(404);
  });

  it("exposes GET only — no handler reads a request body", () => {
    expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual([]);
  });

  it("refuses anything but a committed scenario id", async () => {
    for (const s of ["S12", "S00", "../etc", "", "S1"]) {
      expect((await get(`t=${TOKEN}&s=${encodeURIComponent(s)}`)).status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("preflight", () => {
  it("reports key presence as a boolean and nothing else", async () => {
    const res = await get(`t=${TOKEN}&check=1`);
    const body = await res.json();
    expect(body).toEqual({
      vercel_env: "preview",
      anthropic_key_present: true,
      scenarios: ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11"],
      model: MODEL_RESUME_STANDARD,
    });
    expect(JSON.stringify(body)).not.toContain("test-key-not-real");
  });
});

describe("generation", () => {
  it("runs the production request and returns a verifiable, secret-free body", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [{ type: "text", text: '"summary": "Backend engineer.", "skills": ["Java"], "ats_score": 70, "matched_keywords": [], "missing_keywords": [], "tailored_role": "SDE II", "growth_note": null}' }],
    });
    const res = await get(`t=${TOKEN}&s=S06`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const req = mockCreate.mock.calls[0][0];
    expect(req.model).toBe(MODEL_RESUME_STANDARD);
    expect(req.system).toBe(SYSTEM_PROMPT);
    expect(req.messages[1]).toEqual({ role: "assistant", content: "{" });

    const { sha256, ...rest } = body;
    expect(createHash("sha256").update(JSON.stringify(rest)).digest("hex")).toBe(sha256);
    expect(body.parse_ok).toBe(true);
    expect(body.final_resume.ats_score).toBe(70);
    expect(JSON.stringify(body)).not.toMatch(/test-key-not-real|authorization|x-api-key/i);
  });
});
