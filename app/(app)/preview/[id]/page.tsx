"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Lock } from "lucide-react";
import { downloadAction, paidCreditsLeft, type DownloadAction } from "@/lib/download-entitlement";
import { FREE_PREVIEW_DOWNLOAD_MESSAGE } from "@/lib/plan-config";
import { formatGrade, descriptionBullets } from "@/lib/resume-format";

// Downloads (migration 018): only a resume covered by a PAID credit can be
// downloaded. The free AI resume preview shows why and offers the real next
// step: spend a paid credit on it (if the user has one), or see pricing.
const NOT_DOWNLOADABLE = FREE_PREVIEW_DOWNLOAD_MESSAGE;

type ResumeJson = {
  headline?: string;
  summary: string;
  experience: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills: string[];
  education: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  projects: Array<{ name: string; description: string; tech: string[] }>;
  ats_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  tailored_role: string;
};

type Resume = {
  id: string;
  resume_json: ResumeJson;
  ats_score: number;
  tailored_role: string;
  matched_keywords: string[];
  missing_keywords: string[];
  created_at: string;
  downloaded_at: string | null;
  /** Contact details frozen at generation time. NULL on resumes created before migration 009. */
  contact_snapshot: Profile | null;
};

type Profile = {
  full_name: string;
  email: string;
  phone: string | null;
  current_city: string | null;
};

function ATSRing({ score }: { score: number }) {
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#1f5c3a" : score >= 60 ? "#d97706" : "#dc2626";
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle cx="44" cy="44" r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 44 44)" />
        <text x="44" y="49" textAnchor="middle" fontSize="18" fontWeight="700" fill={color}>{score}</text>
      </svg>
      <span className="text-xs text-[#6b6b6b]">ATS Match</span>
    </div>
  );
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [resume, setResume] = useState<Resume | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  // download | unlock (has a paid credit) | upgrade (no paid credit)
  const [action, setAction] = useState<DownloadAction>("upgrade");
  const [paidLeft, setPaidLeft] = useState(0);
  const [unlocking, setUnlocking] = useState(false);
  const canDownload = action === "download";

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [resumeRes, profileRes, plansRes, entRes] = await Promise.all([
        supabase.from("resumes").select("*").eq("id", id).eq("user_id", user.id).single(),
        supabase.from("profiles").select("full_name,email,phone,current_city").eq("user_id", user.id).single(),
        supabase.from("user_plans").select("plan_type,resumes_used,resumes_allotted,expires_at").eq("user_id", user.id),
        // Covered by a paid credit? (server-written; RLS: own rows only)
        supabase.from("resume_entitlements").select("resume_id").eq("resume_id", id).eq("user_id", user.id).maybeSingle(),
      ]);

      if (resumeRes.error || !resumeRes.data) {
        toast.error("Resume not found.");
        router.push("/dashboard");
        return;
      }

      const r = resumeRes.data as Resume;
      setResume(r);
      // Prefer the contact details captured when this resume was generated, so
      // later profile edits don't rewrite the identity on an already-generated
      // (and possibly already-downloaded) resume. Resumes created before
      // migration 009 have no snapshot and fall back to the live profile.
      if (r.contact_snapshot) {
        setProfile(r.contact_snapshot);
      } else if (profileRes.data) {
        setProfile(profileRes.data as Profile);
      }

      // Same rule the download route enforces (lib/download-entitlement.ts).
      const paid = paidCreditsLeft(plansRes.data ?? []);
      setPaidLeft(paid);
      setAction(downloadAction(!!entRes.data, paid));
      setLoading(false);
    }
    load();
  }, [id, router]);

  // Spends ONE paid credit on this resume, once (repeat downloads are free),
  // then downloads it. The server decides; nothing is granted here.
  async function handleUnlock() {
    setUnlocking(true);
    try {
      const res = await fetch(`/api/resumes/${id}/unlock`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        if (body.status === "unlocked") setPaidLeft((n) => Math.max(0, n - 1));
        setAction("download");
        toast.success(body.status === "unlocked" ? "1 credit used — this resume is now downloadable." : "This resume is already downloadable.");
        await handleDownload(true);
        return;
      }
      if (res.status === 402) { setPaidLeft(0); setAction("upgrade"); }
      toast.error(body.message ?? body.error ?? "Couldn't unlock this resume. No credit was used.");
    } catch {
      toast.error("Couldn't unlock this resume. No credit was used.");
    } finally {
      setUnlocking(false);
    }
  }

  async function handleDownload(justUnlocked = false) {
    if (!canDownload && !justUnlocked) { toast.error(NOT_DOWNLOADABLE); return; }
    if (!canDownload) { toast.error(NOT_DOWNLOADABLE); return; }
    setDownloading(true);
    try {
      const res = await fetch(`/api/download-pdf/${id}`);
      if (res.status === 402) {
        toast.error(NOT_DOWNLOADABLE, { duration: 6000 });
        setAction(downloadAction(false, paidLeft));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const ref = body.debug_id ? ` (ref: ${body.debug_id})` : "";
        toast.error(`Couldn't generate PDF. Our team was notified.${ref}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume-${resume?.tailored_role?.toLowerCase().replace(/\s+/g, "-") ?? "neduresume"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Resume downloaded!");
    } catch {
      toast.error("Couldn't generate PDF. Our team was notified.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f3ea]">
        
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-[#6b6b6b]">Loading resume…</p>
        </div>
      </div>
    );
  }

  if (!resume) return null;
  const rj = resume.resume_json;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      

      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-8">
        {/* Resume preview with watermark */}
        <div className="flex-1 relative">
          <div className="relative bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center" style={{ overflow: "hidden" }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="absolute text-stone-300 font-bold text-lg select-none whitespace-nowrap"
                  style={{ transform: `rotate(-45deg) translate(${(i % 3 - 1) * 200}px, ${Math.floor(i / 3) * 200 - 100}px)`, opacity: 0.15, letterSpacing: "0.2em" }}>
                  NEDURESUME PREVIEW
                </span>
              ))}
            </div>

            <div className="p-8 relative z-0">
              <div className="mb-6 pb-4 border-b border-stone-200">
                <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-1">{profile?.full_name ?? "Your Name"}</h1>
                {rj.headline && <p className="text-sm text-[#444] mb-1">{rj.headline}</p>}
                <p className="text-sm text-[#6b6b6b]">{[profile?.email, profile?.phone, profile?.current_city].filter(Boolean).join(" · ")}</p>
              </div>

              {rj.summary && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-2">Summary</h2>
                  <p className="text-sm text-[#1a1a1a] leading-relaxed">{rj.summary}</p>
                </section>
              )}

              {rj.experience?.length > 0 && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-3">Experience</h2>
                  <div className="flex flex-col gap-4">
                    {rj.experience.map((exp, i) => (
                      <div key={i}>
                        <div className="flex items-baseline justify-between flex-wrap gap-1">
                          <span className="font-semibold text-sm text-[#1a1a1a]">{exp.role}</span>
                          <span className="text-xs text-[#6b6b6b]">{exp.duration}</span>
                        </div>
                        <p className="text-xs text-[#444]">{[exp.company, exp.location].filter(Boolean).join(" · ")}</p>
                        <ul className="mt-1.5 flex flex-col gap-1">
                          {exp.bullets.map((b, j) => (
                            <li key={j} className="text-sm text-[#1a1a1a] pl-3 relative before:absolute before:left-0 before:content-['·'] before:text-[#1f5c3a]">{b}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {rj.skills?.length > 0 && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-2">Skills</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {rj.skills.map((skill, i) => (
                      <span key={i} className="text-xs bg-stone-100 text-[#1a1a1a] px-2 py-0.5 rounded-full border border-stone-200">{skill}</span>
                    ))}
                  </div>
                </section>
              )}

              {rj.education?.length > 0 && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-3">Education</h2>
                  {rj.education.map((edu, i) => (
                    <div key={i} className="mb-2">
                      <div className="flex items-baseline justify-between flex-wrap gap-1">
                        <span className="font-semibold text-sm">{edu.degree}</span>
                        <span className="text-xs text-[#6b6b6b]">{edu.year}</span>
                      </div>
                      <p className="text-xs text-[#444]">{[edu.institution, edu.location, formatGrade(edu.cgpa)].filter(Boolean).join(" · ")}</p>
                    </div>
                  ))}
                </section>
              )}

              {rj.projects?.length > 0 && (
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-3">Projects</h2>
                  <div className="flex flex-col gap-3">
                    {rj.projects.map((proj, i) => (
                      <div key={i}>
                        <span className="font-semibold text-sm">{proj.name}</span>
                        {proj.tech?.length > 0 && <p className="text-xs text-[#1f5c3a]">{proj.tech.join(" · ")}</p>}
                        <ul className="mt-1 flex flex-col gap-1">
                          {descriptionBullets(proj.description ?? "").map((b, j) => (
                            <li key={j} className="text-sm text-[#1a1a1a] pl-3 relative before:absolute before:left-0 before:content-['·'] before:text-[#1f5c3a]">{b}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="lg:w-72 flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm sticky top-20">
            <div className="flex flex-col items-center mb-6">
              <ATSRing score={resume.ats_score ?? rj.ats_score ?? 0} />
            </div>

            {canDownload ? (
              <Button size="lg" className="w-full mb-6" onClick={() => handleDownload()} disabled={downloading}>
                {downloading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating PDF…</>
                  : <><Download className="w-4 h-4 mr-2" />Download PDF</>}
              </Button>
            ) : (
              <div className="w-full mb-6 flex flex-col gap-3">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
                  <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{NOT_DOWNLOADABLE}</span>
                </p>
                {action === "unlock" ? (
                  <Button size="lg" className="w-full" onClick={handleUnlock} disabled={unlocking || downloading}>
                    {unlocking
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Unlocking…</>
                      : <><Download className="w-4 h-4 mr-2" />Use 1 paid credit to download</>}
                  </Button>
                ) : (
                  <Button asChild size="lg" className="w-full">
                    <Link href="/pricing">See pricing for paid credits →</Link>
                  </Button>
                )}
                {action === "unlock" && (
                  <p className="text-xs text-[#6b6b6b] text-center">You have {paidLeft} paid credit{paidLeft !== 1 ? "s" : ""}. Downloading again later is free.</p>
                )}
              </div>
            )}

            {resume.matched_keywords?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#1a1a1a] mb-2">Keywords matched</p>
                <div className="flex flex-wrap gap-1">
                  {resume.matched_keywords.map((kw, i) => <Badge key={i} variant="green" className="text-xs">{kw}</Badge>)}
                </div>
              </div>
            )}

            {resume.missing_keywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#1a1a1a] mb-2">Consider adding</p>
                <div className="flex flex-wrap gap-1">
                  {resume.missing_keywords.map((kw, i) => <Badge key={i} variant="amber" className="text-xs">{kw}</Badge>)}
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-stone-100 flex flex-col gap-2">
              <p className="text-xs text-[#6b6b6b] text-center mb-2">
                Tailored for: <span className="font-medium text-[#1a1a1a]">{resume.tailored_role}</span>
              </p>
              <Button variant="outline" size="sm" className="w-full text-xs" asChild>
                <Link href={`/profile?from=preview&resumeId=${id}`}>Update profile &amp; regenerate →</Link>
              </Button>
              <Button variant="ghost" size="sm" className="w-full text-xs text-[#6b6b6b]" asChild>
                <Link href="/create">Generate for a different job →</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
