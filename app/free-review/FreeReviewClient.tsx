"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { track } from "@/lib/analytics";

type ScoreFreeResult = {
  ats_score: number;
  keyword_match_pct: number;
  matched_keywords: string[];
  missing_keywords: string[];
  skills_overlap: string[];
  structure_flags: string[];
  parsed: {
    word_count: number;
    bullet_count: number;
    has_summary: boolean;
    has_experience: boolean;
    has_education: boolean;
    skill_count: number;
  };
};

const FLAG_LABELS: Record<string, string> = {
  "missing-summary": "Add a 2-3 sentence summary section.",
  "missing-experience-or-projects": "Add at least one experience or project entry.",
  "missing-education": "Add an education section.",
  "missing-skills-section": "Add a skills section listing your tech stack.",
  "missing-contact-email": "Include your email address near the top.",
  "too-few-quantified-bullets": "At least 2 bullets should include numbers (%, ₹, counts).",
  "weak-action-verbs": "Start more bullets with strong verbs (Led, Built, Designed…).",
  "too-long": "Resume is over 900 words — trim to one A4 page.",
  "too-short": "Resume is under 250 words — flesh out experience and skills.",
  "weak-openers-present": "Avoid weak openers like \"Responsible for\", \"Worked on\", \"Helped\".",
  "bias-fields-present": "Remove date of birth, marital status, photo, religion, caste — Indian ATS bias triggers.",
};

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 60) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
}

type Gate = null | "needs_signup" | "free_used";

export default function FreeReviewPage() {
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScoreFreeResult | null>(null);
  const [gate, setGate] = useState<Gate>(null);

  async function handleRun() {
    if (resumeText.trim().length < 50 || jdText.trim().length < 50) {
      toast.error("Paste at least 50 characters of resume and JD.");
      return;
    }
    setRunning(true);
    setResult(null);
    setGate(null);
    track("free_review_start", { resume_chars: resumeText.length, jd_chars: jdText.length });
    try {
      const res = await fetch("/api/score-free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jdText }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setGate("needs_signup");
        return;
      }
      if (res.status === 402) {
        setGate("free_used");
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Review failed.");
        return;
      }
      setResult(data as ScoreFreeResult);
      track("free_review_complete", {
        ats_score: data.ats_score,
        keyword_match_pct: data.keyword_match_pct,
      });
    } catch {
      toast.error("Review failed. Please retry.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/90 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-serif italic text-xl text-[#1f5c3a] font-bold">
            Neduresume
          </Link>
          <Link href="/pricing" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
            Pricing
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-[#1f5c3a] bg-[#1f5c3a]/10 border border-[#1f5c3a]/25 rounded-full px-3 py-1 mb-4">
            <Sparkles className="w-3 h-3" />
            Free ATS preview · No card required
          </p>
          <h1 className="font-serif italic text-4xl text-[#1a1a1a] mb-3">
            Score your resume against any JD
          </h1>
          <p className="text-[#6b6b6b] text-sm max-w-xl mx-auto">
            One free ATS preview per account. Deterministic keyword + structure check —
            no AI, no data sent to any LLM. Sign up takes 10 seconds and never asks for a card.
          </p>
        </div>

        {gate === "needs_signup" && (
          <div className="mb-6 rounded-xl border border-[#1f5c3a]/30 bg-[#1f5c3a]/5 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1a1a1a]">Sign up to run your free preview</p>
              <p className="text-xs text-[#6b6b6b] mt-1">Account required so we can give you exactly one free review. No card asked.</p>
            </div>
            <Button asChild className="bg-[#1f5c3a] hover:bg-[#174d30]">
              <Link href="/signup?next=/free-review">Sign up free →</Link>
            </Button>
          </div>
        )}

        {gate === "free_used" && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1a1a1a]">You&apos;ve used your free preview</p>
              <p className="text-xs text-[#6b6b6b] mt-1">Generate a tailored, ATS-pass resume from ₹99 — see plans on the pricing page.</p>
            </div>
            <Button asChild className="bg-[#1f5c3a] hover:bg-[#174d30]">
              <Link href="/pricing">See plans</Link>
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-[#1a1a1a] mb-1 block">Your resume (plain text)</label>
            <Textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={14}
              placeholder="Paste your resume here…"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[#1a1a1a] mb-1 block">Job description</label>
            <Textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              rows={14}
              placeholder="Paste the JD here…"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex justify-center mb-10">
          <Button
            size="lg"
            onClick={handleRun}
            disabled={running}
            className="bg-[#1f5c3a] hover:bg-[#174d30]"
          >
            {running ? "Scoring…" : "Run free ATS review"}
          </Button>
        </div>

        {result && (
          <div className="rounded-xl border border-stone-200 bg-white p-6 flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className={`rounded-xl border px-5 py-4 ${scoreColor(result.ats_score)}`}>
                <p className="text-xs font-semibold uppercase tracking-wide">ATS Score</p>
                <p className="text-4xl font-bold mt-1">{result.ats_score}</p>
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#1a1a1a]">
                  <strong>{result.keyword_match_pct}%</strong> of JD keywords matched
                  · <strong>{result.skills_overlap.length}</strong> skills overlap
                  · <strong>{result.parsed.word_count}</strong> words parsed
                </p>
                <p className="text-xs text-[#6b6b6b] mt-1">
                  This is a free deterministic score. To generate an AI-tailored resume
                  for this JD, upgrade below.
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#1a1a1a] mb-2">Matched keywords</p>
              <div className="flex flex-wrap gap-1.5">
                {result.matched_keywords.length === 0 && (
                  <span className="text-xs text-[#6b6b6b]">None matched.</span>
                )}
                {result.matched_keywords.slice(0, 20).map((k) => (
                  <span
                    key={k}
                    className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full px-2.5 py-0.5 inline-flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" />
                    {k}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#1a1a1a] mb-2">
                Missing keywords (top {result.missing_keywords.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.missing_keywords.length === 0 && (
                  <span className="text-xs text-[#6b6b6b]">No critical gaps.</span>
                )}
                {result.missing_keywords.map((k) => (
                  <span
                    key={k}
                    className="text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-full px-2.5 py-0.5"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>

            {result.structure_flags.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a] mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Structure improvements
                </p>
                <ul className="flex flex-col gap-1.5 text-sm text-[#1a1a1a]">
                  {result.structure_flags.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-amber-600">•</span>
                      <span>{FLAG_LABELS[f] ?? f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t border-stone-200 pt-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
              <p className="text-sm text-[#6b6b6b]">
                Want an AI-tailored resume for this JD?
              </p>
              <Button asChild size="sm" className="bg-[#1f5c3a] hover:bg-[#174d30]">
                <Link href="/pricing">Generate ATS-tailored resume — ₹99</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
