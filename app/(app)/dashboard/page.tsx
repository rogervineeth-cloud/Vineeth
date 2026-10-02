"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Download, Eye, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FREE_PREVIEW_RULE, FREE_PREVIEW_DOWNLOAD_MESSAGE } from "@/lib/plan-config";
import { loadPlansEnsuringBeta } from "@/lib/beta-client";
import { downloadAction, paidCreditsLeft, freeCreditsLeft } from "@/lib/download-entitlement";

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

type Credits = { free: number; paid: number } | null;

function PlanBadge({ credits }: { credits: Credits }) {
  // What the server enforces (migration 018): 1 free AI resume preview per
  // account (viewable, not downloadable); paid credits for more resumes and
  // for PDF downloads. No disabled purchase control: pricing is linked.
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-[#1f5c3a]/5 border border-[#1f5c3a]/20 rounded-xl px-5 py-3">
      <div className="flex-1">
        <p className="text-sm font-semibold text-[#1a1a1a]">{FREE_PREVIEW_RULE}</p>
        <p className="text-xs text-[#6b6b6b]">
          {credits === null
            ? "We couldn't load your credits. Please refresh the page."
            : `Free AI resume preview: ${credits.free > 0 ? "1 available" : "used"} · Paid credits: ${credits.paid}`}
        </p>
      </div>
      {credits !== null && credits.paid === 0 && (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href="/pricing">See pricing →</Link>
        </Button>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [credits, setCredits] = useState<Credits | undefined>(undefined);
  // Resumes covered by a paid credit (resume_entitlements; RLS: own rows).
  const [entitled, setEntitled] = useState<Set<string>>(new Set());
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Delete is confirmed in a dialog rather than fired on a single click —
  // there is no undo, and the row is gone for good.
  const [pendingDelete, setPendingDelete] = useState<Resume | null>(null);
  const [deleting, setDeleting] = useState(false);


  function handleAskDelete(e: React.MouseEvent, resume: Resume) {
    e.preventDefault();
    e.stopPropagation();
    setPendingDelete(resume);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const target = pendingDelete;
    try {
      const supabase = createClient();
      // RLS restricts this to the owner's own rows; the user_id filter is a
      // second line of defence, not the only one.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Session expired."); return; }

      const { error } = await supabase
        .from("resumes")
        .delete()
        .eq("id", target.id)
        .eq("user_id", user.id);

      if (error) { toast.error("Couldn't delete: " + error.message); return; }

      setResumes((prev) => prev.filter((r) => r.id !== target.id));
      setPendingDelete(null);
      toast.success(`Deleted "${target.tailored_role || "Resume"}".`);
    } catch {
      toast.error("Couldn't delete that resume. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }

      const [resumesRes, plans, entRes] = await Promise.all([
        supabase
          .from("resumes")
          .select("id,tailored_role,ats_score,resume_json,created_at,downloaded_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        // All plans (not only unexpired), granting the Free Beta credits first
        // if this account has never had them.
        loadPlansEnsuringBeta(supabase, user.id).catch(() => null),
        supabase.from("resume_entitlements").select("resume_id").eq("user_id", user.id),
      ]);

      if (resumesRes.error) toast.error("Couldn't load resumes.");
      else setResumes((resumesRes.data as Resume[]) ?? []);

      setCredits(plans ? { free: freeCreditsLeft(plans), paid: paidCreditsLeft(plans) } : null);
      setEntitled(new Set(((entRes.data as { resume_id: string }[] | null) ?? []).map((e) => e.resume_id)));
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
        // Not covered by a paid credit (the server is the authority).
        toast.error(FREE_PREVIEW_DOWNLOAD_MESSAGE, { action: { label: "See pricing", onClick: () => router.push("/pricing") }, duration: 6000 });
        setEntitled((prev) => { const n = new Set(prev); n.delete(resumeId); return n; });
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

  // Spends ONE paid credit on a free preview, once, then downloads it.
  async function handleUnlock(e: React.MouseEvent, resumeId: string) {
    e.preventDefault();
    e.stopPropagation();
    setUnlocking(resumeId);
    try {
      const res = await fetch(`/api/resumes/${resumeId}/unlock`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 402) setCredits((c) => (c ? { ...c, paid: 0 } : c));
        toast.error(body.message ?? body.error ?? "Couldn't unlock this resume. No credit was used.");
        return;
      }
      if (body.status === "unlocked") setCredits((c) => (c ? { ...c, paid: Math.max(0, c.paid - 1) } : c));
      setEntitled((prev) => new Set(prev).add(resumeId));
      toast.success(body.status === "unlocked" ? "1 credit used — this resume is now downloadable." : "This resume is already downloadable.");
    } catch {
      toast.error("Couldn't unlock this resume. No credit was used.");
      return;
    } finally {
      setUnlocking(null);
    }
    await handleQuickDownload(e, resumeId);
  }

  const avgATS = resumes.length
    ? Math.round(resumes.reduce((s, r) => s + (r.ats_score ?? 0), 0) / resumes.length)
    : 0;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Plan badge */}
        {credits !== undefined && (
          <div className="mb-8">
            <PlanBadge credits={credits} />
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
                // A card, not one big link: the actions used to be <button>s
                // nested inside the card's <a> (invalid, and a tap on one could
                // also follow the link). The title link is stretched over the
                // card so a click or tap anywhere still opens the preview; the
                // actions sit above it as their own controls.
                <div
                  key={resume.id}
                  className="group relative bg-white rounded-xl border border-stone-200 p-5 shadow-sm hover:shadow-md hover:border-[#1f5c3a]/30 focus-within:border-[#1f5c3a]/40 transition-all flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/preview/${resume.id}`}
                      className="font-serif italic text-lg text-[#1a1a1a] leading-tight rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f5c3a]/50"
                    >
                      {resume.tailored_role || "Resume"}
                    </Link>
                    <ATSBadge score={resume.ats_score ?? 0} />
                  </div>
                  {!entitled.has(resume.id) && (
                    <p className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 self-start">
                      Free view-only preview · 1 paid credit unlocks the PDF
                    </p>
                  )}
                  {truncated && <p className="text-xs text-[#6b6b6b] leading-relaxed flex-1">{truncated}</p>}
                  <p className="text-xs text-[#6b6b6b]">{formatDate(resume.created_at)}</p>
                  {/* Always visible and always tappable. They used to be fully
                      transparent until hover on any device reporting hover —
                      including touchscreen laptops — while still clickable
                      while invisible. Larger targets on coarse pointers. */}
                  <div className="relative z-10 flex gap-2">
                    <Button asChild size="sm" variant="outline" className="flex-1 text-xs h-8 [@media(pointer:coarse)]:h-11">
                      <Link href={`/preview/${resume.id}`} aria-label={`View ${resume.tailored_role || "resume"}`}>
                        <Eye className="w-3 h-3 mr-1" aria-hidden="true" />View
                      </Link>
                    </Button>
                    {(() => {
                      const act = downloadAction(entitled.has(resume.id), credits?.paid ?? 0);
                      const name = resume.tailored_role || "resume";
                      if (act === "download") return (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs h-8 [@media(pointer:coarse)]:h-11"
                          aria-label={`Download ${name} as PDF`}
                          onClick={(e) => handleQuickDownload(e, resume.id)}
                          disabled={downloading === resume.id}>
                          <Download className="w-3 h-3 mr-1" aria-hidden="true" />
                          {downloading === resume.id ? "…" : "Download"}
                        </Button>
                      );
                      if (act === "unlock") return (
                        <Button size="sm" variant="ghost" className="flex-1 text-xs h-8 [@media(pointer:coarse)]:h-11"
                          aria-label={`Use 1 paid credit to download ${name} as PDF`}
                          onClick={(e) => handleUnlock(e, resume.id)}
                          disabled={unlocking === resume.id || downloading === resume.id}>
                          <Download className="w-3 h-3 mr-1" aria-hidden="true" />
                          {unlocking === resume.id ? "…" : "Unlock PDF (1 credit)"}
                        </Button>
                      );
                      return (
                        <Button asChild size="sm" variant="ghost" className="flex-1 text-xs h-8 [@media(pointer:coarse)]:h-11">
                          <Link href="/pricing" aria-label={`Unlocking the PDF of ${name} costs 1 paid credit — see pricing`}>Get a paid credit</Link>
                        </Button>
                      );
                    })()}
                    <Button size="sm" variant="ghost"
                      className="text-xs h-8 px-2 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-3 text-[#6b6b6b] hover:text-red-600 hover:bg-red-50"
                      aria-label={`Delete ${resume.tailored_role || "resume"}`}
                      onClick={(e) => handleAskDelete(e, resume)}>
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {resumes.length > 0 && (
        <Link href="/create"
          className="hidden w-14 h-14 rounded-full bg-[#1f5c3a] text-white shadow-lg flex items-center justify-center hover:bg-[#174d30] transition-colors z-20">
          <Plus className="w-6 h-6" />
        </Link>
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif italic text-2xl">Delete this resume?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-[#1a1a1a]">
                {pendingDelete?.tailored_role || "Resume"}
              </span>
              {" — "}this can&apos;t be undone. If you already downloaded the PDF, that
              copy is unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end mt-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Keep it
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete resume"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
