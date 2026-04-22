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

type Resume = {
  id: string;
  tailored_role: string;
  ats_score: number;
  resume_json: { summary: string };
  created_at: string;
  downloaded_at: string | null;
};

function ATSBadge({ score }: { score: number }) {
  if (score >= 80) return <Badge variant="green">{score}</Badge>;
  if (score >= 60) return <Badge variant="amber">{score}</Badge>;
  return <Badge variant="destructive">{score}</Badge>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function DashboardPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }

      const { data, error } = await supabase
        .from("resumes")
        .select("id,tailored_role,ats_score,resume_json,created_at,downloaded_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        toast.error("Couldn't load resumes.");
      } else {
        setResumes((data as Resume[]) ?? []);
      }
      setLoading(false);
    });
  }, [router]);

  async function handleQuickDownload(e: React.MouseEvent, resumeId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDownloading(resumeId);
    try {
      const res = await fetch(`/api/download-pdf/${resumeId}`);
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
    <div className="min-h-screen bg-[#fffaa7]">
      <AppHeader />

      <div className="max-w-5xl mx-auto px-6 py-12">
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
          /* Empty state */
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
          /* Resume grid */
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

                  {truncated && (
                    <p className="text-xs text-[#6b6b6b] leading-relaxed flex-1">{truncated}</p>
                  )}

                  <p className="text-xs text-[#6b6b6b]">{formatDate(resume.created_at)}</p>

                  {/* Hover actions */}
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs h-8"
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link href={`/preview/${resume.id}`}>
                        <Eye className="w-3 h-3 mr-1" />
                        View
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs h-8"
                      onClick={(e) => handleQuickDownload(e, resume.id)}
                      disabled={downloading === resume.id}
                    >
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

      {/* Floating + button */}
      {resumes.length > 0 && (
        <Link
          href="/create"
          className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-[#1f5c3a] text-white shadow-lg flex items-center justify-center hover:bg-[#174d30] transition-colors z-20"
        >
          <Plus className="w-6 h-6" />
        </Link>
      )}
    </div>
  );
}
