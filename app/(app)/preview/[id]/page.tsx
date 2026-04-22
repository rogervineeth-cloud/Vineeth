"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type ResumeJson = {
  summary: string;
  experience: Array<{
    company: string;
    role: string;
    duration: string;
    location: string;
    bullets: string[];
  }>;
  skills: string[];
  education: Array<{
    institution: string;
    degree: string;
    year: string;
    location: string;
    cgpa?: string;
  }>;
  projects: Array<{
    name: string;
    description: string;
    tech: string[];
  }>;
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
        <circle
          cx="44" cy="44" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="49" textAnchor="middle" fontSize="18" fontWeight="700" fill={color}>
          {score}
        </text>
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

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [resumeRes, profileRes] = await Promise.all([
        supabase.from("resumes").select("*").eq("id", id).eq("user_id", user.id).single(),
        supabase.from("profiles").select("full_name,email,phone,current_city").eq("user_id", user.id).single(),
      ]);

      if (resumeRes.error || !resumeRes.data) {
        toast.error("Resume not found.");
        router.push("/dashboard");
        return;
      }

      setResume(resumeRes.data as Resume);
      if (profileRes.data) setProfile(profileRes.data as Profile);
      setLoading(false);
    }

    load();
  }, [id, router]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/download-pdf/${id}`);
      if (!res.ok) {
        toast.error("PDF generation failed. Try again.");
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
      toast.error("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f3ea]">
        <AppHeader />
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
      <AppHeader />

      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-8">
        {/* Resume Preview (with watermark) */}
        <div className="flex-1 relative">
          <div className="relative bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            {/* Watermark */}
            <div
              className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center"
              style={{ overflow: "hidden" }}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute text-stone-300 font-bold text-lg select-none whitespace-nowrap"
                  style={{
                    transform: `rotate(-45deg) translate(${(i % 3 - 1) * 200}px, ${Math.floor(i / 3) * 200 - 100}px)`,
                    opacity: 0.15,
                    letterSpacing: "0.2em",
                  }}
                >
                  NEDURESUME PREVIEW
                </span>
              ))}
            </div>

            {/* Resume content */}
            <div className="p-8 relative z-0">
              {/* Header */}
              <div className="mb-6 pb-4 border-b border-stone-200">
                <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-1">
                  {profile?.full_name ?? "Your Name"}
                </h1>
                <p className="text-sm text-[#6b6b6b]">
                  {[profile?.email, profile?.phone, profile?.current_city].filter(Boolean).join(" · ")}
                </p>
              </div>

              {/* Summary */}
              {rj.summary && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-2">Summary</h2>
                  <p className="text-sm text-[#1a1a1a] leading-relaxed">{rj.summary}</p>
                </section>
              )}

              {/* Experience */}
              {rj.experience?.length > 0 && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-3">Experience</h2>
                  <div className="flex flex-col gap-4">
                    {rj.experience.map((exp, i) => (
                      <div key={i}>
                        <div className="flex items-baseline justify-between flex-wrap gap-1">
                          <span className="font-semibold text-sm text-[#1a1a1a]">
                            {exp.company} — {exp.role}
                          </span>
                          <span className="text-xs text-[#6b6b6b]">{exp.duration} · {exp.location}</span>
                        </div>
                        <ul className="mt-1.5 flex flex-col gap-1">
                          {exp.bullets.map((b, j) => (
                            <li key={j} className="text-sm text-[#1a1a1a] pl-3 relative before:absolute before:left-0 before:content-['·'] before:text-[#1f5c3a]">
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Skills */}
              {rj.skills?.length > 0 && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-2">Skills</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {rj.skills.map((skill, i) => (
                      <span key={i} className="text-xs bg-stone-100 text-[#1a1a1a] px-2 py-0.5 rounded-full border border-stone-200">
                        {skill}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Education */}
              {rj.education?.length > 0 && (
                <section className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-3">Education</h2>
                  {rj.education.map((edu, i) => (
                    <div key={i} className="flex items-baseline justify-between flex-wrap gap-1">
                      <div>
                        <span className="font-semibold text-sm">{edu.institution}</span>
                        <span className="text-sm text-[#6b6b6b]"> · {edu.degree}</span>
                        {edu.cgpa && <span className="text-xs text-[#6b6b6b]"> · {edu.cgpa}</span>}
                      </div>
                      <span className="text-xs text-[#6b6b6b]">{edu.year} · {edu.location}</span>
                    </div>
                  ))}
                </section>
              )}

              {/* Projects */}
              {rj.projects?.length > 0 && (
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#1f5c3a] mb-3">Projects</h2>
                  <div className="flex flex-col gap-3">
                    {rj.projects.map((proj, i) => (
                      <div key={i}>
                        <span className="font-semibold text-sm">{proj.name}</span>
                        <p className="text-sm text-[#6b6b6b] mt-0.5">{proj.description}</p>
                        {proj.tech?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {proj.tech.map((t, j) => (
                              <span key={j} className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Right panel — ATS score + download */}
        <div className="lg:w-72 flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm sticky top-20">
            <div className="flex flex-col items-center mb-6">
              <ATSRing score={resume.ats_score ?? rj.ats_score ?? 0} />
            </div>

            <Button size="lg" className="w-full mb-6" onClick={handleDownload} disabled={downloading}>
              <Download className="w-4 h-4 mr-2" />
              {downloading ? "Generating PDF…" : "Download PDF"}
            </Button>

            {resume.matched_keywords?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#1a1a1a] mb-2">Keywords matched</p>
                <div className="flex flex-wrap gap-1">
                  {resume.matched_keywords.map((kw, i) => (
                    <Badge key={i} variant="green" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </div>
            )}

            {resume.missing_keywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#1a1a1a] mb-2">Consider adding</p>
                <div className="flex flex-wrap gap-1">
                  {resume.missing_keywords.map((kw, i) => (
                    <Badge key={i} variant="amber" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-stone-100">
              <p className="text-xs text-[#6b6b6b] text-center">
                Tailored for: <span className="font-medium text-[#1a1a1a]">{resume.tailored_role}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
