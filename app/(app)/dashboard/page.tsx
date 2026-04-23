"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Download, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLAN_LABELS } from "@/lib/plan-config";
import type { PlanType } from "@/lib/plan-config";

type Resume = {
  id: string;
  tailored_role: string;
  ats_score: number;
  resume_json: { summary: string };
  created_at: string;
  downloaded_at: string | null;
};

type UserPlan = {
  id: string;
  plan_type: PlanType;
  resumes_allotted: number;
  resumes_used: number;
  expires_at: string;
};

function ATSBadge({ score }: { score: number }) {
  if (score >= 80) return <Badge variant="green">{score}</Badge>;
  if (score >= 60) return <Badge variant="amber">{score}</Badge>;
  return <Badge variant="destructive">{score}</Badge>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function PlanBadge({ plan }: { plan: UserPlan | null }) {
  if (!plan) {
    return (
      <div className="flex items-center gap-3 bg-stone-100 border border-stone-200 rounded-xl px-5 py-3">
        <div>
          <p className="text-sm font-medium text-[#1a1a1a]">Free tier · 0 resumes</p>
          <p className="text-xs text-[#6b6b6b]">Preview is free. Download requires a paid pack.</p>
        </div>
        <Link href="/pricing" className="ml-auto shrink-0">
          <Button size="sm" variant="outline">Upgrade to create a resume →</Button>
        </Link>
      </div>
    );
  }

  const remaining = plan.resumes_allotted - plan.resumes_used;
  const label = PLAN_LABELS[plan.plan_type] ?? plan.plan_type;

  return (
    <div className="flex items-center gap-3 bg-[#1f5c3a]/5 border border-[#1f5c3a]/20 rounded-xl px-5 py-3">
      <div className="w-2 h-2 rounded-full bg-[#1f5c3a] shrink-0" />
      <div>
        <p className="text-sm font-semibold text-[#1a1a1a]">
          {label} plan · {remaining} of {plan.resumes_allotted} resume{plan.resumes_allotted !== 1 ? "s" : ""} remaining
        </p>
        <p className="text-xs text-[#6b6b6b]">Expires {formatDate(plan.expires_at)}</p>
      </div>
      {remaining === 0 && (
        <Link href="/pricing" className="ml-auto shrink-0">
          <Button size="sm" variant="outline">Buy another pack</Button>
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [activePlan, setActivePlan] = useState<UserPlan | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }

      const [resumesRes, plansRes] = await Promise.all([
        supabase
          .from("resumes")
          .select("id,tailored_role,ats_score,resume_json,created_at,downloaded_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("user_plans")
          .select("id,plan_type,resumes_allotted,resumes_used,expires_at")
          .eq("user_id", user.id)
          .gt("expires_at", new Date().toISOString())
          .order("purchased_at", { ascending: false }),
      ]);

      if (resumesRes.error) toast.error("Couldn't load resumes.");
      else setResumes((resumesRes.data as Resume[]) ?? []);

      const plans = (plansRes.data as UserPlan[]) ?? [];
      const active = plans.find((p) => p.resumes_used < p.resumes_allotted) ?? null;
      setActivePlan(active);
      setLoading(false);
    });
  }, [router]);

  async function handleQuickDownload(e: React.MouseEvent, resumeId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDownloading(resumeId);
    try {
      const res = await fetch(`/api/download-pdf/${resumeId}`);
      if (res.status === 402) {
        toast.error("A paid plan is required to download.", {
          action: { label: "View plans", onClick: () => router.push("/pricing") },
          duration: 5000,
        });
        return;
      }
      if (!res.ok) { toast.error("Download failed."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resume.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed.");
    } finally {
      setDownloading(null);
    }
  }

  const avgATS = resumes.length
    ? Math.round(resumes.reduce((s, r) => s + (r.ats_score ?? 0), 0) / resumes.length)
    : 0;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <AppHeader />

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Plan badge */}
        {activePlan !== undefined && (
          <div className="mb-8">
            <PlanBadge plan={activePlan} />
          </div>
        )}

        {/* Header stats */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="font-serif italic text-4xl text-[#1a1a1a] mb-1">Your resumes</h1>
            {resumes.length > 0 && (
              <p className="text-[#6b6b6b] text-sm">
                {resumes.length} resume{resumes.length !== 1 ? "s" : ""} · avg ATS score{" "}
                <span className="font-semibold text-[#1a1a1a]">{avgATS}</span>
              </p>
            )}
          </div>
          <Button asChild>
            <Link href="/create">
              <Plus className="w-4 h-4 mr-1" />
              New resume
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-[#6b6b6b]">Loading…</div>
        ) : resumes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-[#1f5c3a]/10 flex items-center justify-center">
              <Plus className="w-7 h-7 text-[#1f5c3a]" />
            </div>
            <div>
              <h2 className="font-serif italic text-2xl text-[#1a1a1a] mb-2">No resumes yet</h2>
              <p className="text-[#6b6b6b] text-sm">Let&apos;s build your first one.</p>
            </div>
            <Button asChild size="lg">
              <Link href="/create">Build my first resume</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {resumes.map((resume) => {
              const summary = resume.resume_json?.summary ?? "";
              const truncated = summary.length > 120 ? summary.slice(0, 120) + "…" : summary;
              return (
                <Link
                  key={resume.id}
                  href={`/preview/${resume.id}`}
                  className="group relative bg-white rounded-xl border border-stone-200 p-5 shadow-sm hover:shadow-md hover:border-[#1f5c3a]/30 transition-all flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-serif italic text-lg text-[#1a1a1a] leading-tight">
                      {resume.tailored_role || "Resume"}
                    </p>
                    <ATSBadge score={resume.ats_score ?? 0} />
                  </div>
                  {truncated && <p className="text-xs text-[#6b6b6b] leading-relaxed flex-1">{truncated}</p>}
                  <p className="text-xs text-[#6b6b6b]">{formatDate(resume.created_at)}</p>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="outline" className="flex-1 text-xs h-8" asChild
                      onClick={(e) => e.stopPropagation()}>
                      <Link href={`/preview/${resume.id}`}>
                        <Eye className="w-3 h-3 mr-1" />View
                      </Link>
                    </Button>
                    <Button size="sm" variant="ghost" className="flex-1 text-xs h-8"
                      onClick={(e) => handleQuickDownload(e, resume.id)}
                      disabled={downloading === resume.id}>
                      <Download className="w-3 h-3 mr-1" />
                      {downloading === resume.id ? "…" : "Download"}
                    </Button>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {resumes.length > 0 && (
        <Link href="/create"
          className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-[#1f5c3a] text-white shadow-lg flex items-center justify-center hover:bg-[#174d30] transition-colors z-20">
          <Plus className="w-6 h-6" />
        </Link>
      )}
    </div>
  );
}
