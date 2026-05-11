"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Briefcase, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Rewrite = {
  headline: string;
  about: string;
  experience: { company: string; role: string; summary: string }[];
};

export default function LinkedinRewriteClient() {
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [currentText, setCurrentText] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [running, setRunning] = useState(false);
  const [rewrite, setRewrite] = useState<Rewrite | null>(null);
  const [needsAddon, setNeedsAddon] = useState(false);

  async function handleRun() {
    if (currentText.trim().length < 50 || targetRole.trim().length < 2) {
      toast.error("Paste at least 50 characters of LinkedIn content and a target role.");
      return;
    }
    setRunning(true);
    setRewrite(null);
    setNeedsAddon(false);
    try {
      const res = await fetch("/api/linkedin-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: linkedinUrl,
          current_text: currentText,
          target_role: targetRole,
        }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setNeedsAddon(true);
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Rewrite failed.");
        return;
      }
      setRewrite(data.rewrite as Rewrite);
    } catch {
      toast.error("Rewrite failed. Please retry.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-[#0A66C2]/10 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-[#0A66C2]" />
          </div>
          <h1 className="font-serif italic text-3xl text-[#1a1a1a]">LinkedIn Profile Rewrite</h1>
        </div>
        <p className="text-sm text-[#6b6b6b] mb-8">
          Paste your current LinkedIn content (or URL) and the role you&apos;re targeting. We&apos;ll
          rewrite the Headline, About, and 3 Experience sections.
        </p>

        {needsAddon && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
            <span>You don&apos;t have an active LinkedIn Rewrite entitlement.</span>
            <Button asChild size="sm" variant="outline">
              <Link href="/pricing">Get LinkedIn Rewrite</Link>
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 mb-4">
          <div>
            <Label htmlFor="li-url">LinkedIn URL (optional)</Label>
            <Input
              id="li-url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/your-handle"
            />
          </div>
          <div>
            <Label htmlFor="li-target">Target role</Label>
            <Input
              id="li-target"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="e.g. Backend Engineer at a fintech in Bangalore"
            />
          </div>
          <div>
            <Label htmlFor="li-text">Current LinkedIn content (paste Headline + About + Experience)</Label>
            <Textarea
              id="li-text"
              rows={12}
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              placeholder="Paste your existing LinkedIn text here…"
              className="font-mono text-xs"
            />
          </div>
        </div>

        <Button
          onClick={handleRun}
          disabled={running}
          className="bg-[#1f5c3a] hover:bg-[#174d30] gap-2"
        >
          <Sparkles className="w-4 h-4" />
          {running ? "Rewriting…" : "Rewrite my LinkedIn"}
        </Button>

        {rewrite && (
          <div className="mt-10 flex flex-col gap-6">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#1f5c3a] mb-2">Headline</p>
              <p className="text-base text-[#1a1a1a]">{rewrite.headline}</p>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#1f5c3a] mb-2">About</p>
              <p className="text-sm text-[#1a1a1a] whitespace-pre-line leading-relaxed">{rewrite.about}</p>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white p-5 flex flex-col gap-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#1f5c3a]">Experience (3 sections)</p>
              {rewrite.experience.map((e, i) => (
                <div key={i} className="border-t border-stone-200 first:border-t-0 pt-4 first:pt-0">
                  <p className="text-sm font-semibold text-[#1a1a1a]">
                    {e.role} <span className="text-[#6b6b6b] font-normal">— {e.company}</span>
                  </p>
                  <p className="text-sm text-[#1a1a1a] mt-1 whitespace-pre-line leading-relaxed">{e.summary}</p>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
