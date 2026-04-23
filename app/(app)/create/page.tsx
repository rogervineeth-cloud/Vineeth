"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { AppHeader } from "@/components/app-header";
import { UserCircle } from "lucide-react";

const PROGRESS_STEPS = [
  { label: "Analyzing job description…", pct: 15 },
  { label: "Extracting keywords…", pct: 35 },
  { label: "Tailoring your experience…", pct: 60 },
  { label: "Calculating ATS score…", pct: 80 },
  { label: "Finalizing…", pct: 95 },
];

type ProfileData = {
  summary?: string;
  experience?: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills?: string[];
  education?: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  projects?: Array<{ name: string; description: string; tech: string[] }>;
};

type Profile = {
  full_name: string;
  email: string;
  phone: string | null;
  current_city: string | null;
  graduation_year: number | null;
  target_roles: string[] | null;
  linkedin_data: Record<string, unknown> | null;
  profile_data: ProfileData | null;
};

type PlanCheck =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "NO_PLAN" | "CREDITS_EXHAUSTED"; allotted: number };

type Completeness =
  | { complete: true }
  | { complete: false; missing: string };

function checkCompleteness(profile: Profile | null): Completeness {
  if (!profile) return { complete: false, missing: "profile" };
  if (!profile.full_name?.trim()) return { complete: false, missing: "name" };
  if (!profile.target_roles?.length) return { complete: false, missing: "target roles" };
  const pd = profile.profile_data;
  const hasExp = (pd?.experience?.length ?? 0) > 0;
  const hasEdu = (pd?.education?.length ?? 0) > 0;
  if (!hasExp && !hasEdu) return { complete: false, missing: "at least one experience or education entry" };
  return { complete: true };
}

export default function CreatePage() {
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [planCheck, setPlanCheck] = useState<PlanCheck | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;

      const [profileRes, plansRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).single(),
        supabase.from("user_plans")
          .select("resumes_used,resumes_allotted,expires_at")
          .eq("user_id", user.id)
          .gt("expires_at", new Date().toISOString()),
      ]);

      if (profileRes.data) setProfile(profileRes.data as Profile);

      const plans = plansRes.data ?? [];
      const active = plans.find((p) => p.resumes_used < p.resumes_allotted);
      if (active) {
        setPlanCheck({ allowed: true, remaining: active.resumes_allotted - active.resumes_used });
      } else if (plans.length > 0) {
        const latest = plans[0];
        setPlanCheck({ allowed: false, reason: "CREDITS_EXHAUSTED", allotted: latest.resumes_allotted });
      } else {
        setPlanCheck({ allowed: false, reason: "NO_PLAN", allotted: 0 });
      }
      setLoaded(true);
    });
  }, []);

  async function handleGenerate() {
    if (jdText.trim().length < 200) {
      toast.error("Please paste a longer job description (min 200 characters).");
      return;
    }
    if (!profile) {
      toast.error("Please complete your profile first.");
      router.push("/profile");
      return;
    }
    if (planCheck && !planCheck.allowed) {
      toast.error(
        planCheck.reason === "NO_PLAN"
          ? "You need a paid plan to generate a resume."
          : "You've used all credits in your current plan.",
        { action: { label: "View plans", onClick: () => router.push("/pricing") }, duration: 5000 }
      );
      return;
    }

    setGenerating(true);
    setGenError(null);
    setProgress(5);
    setProgressLabel("Starting…");

    let stepIdx = 0;
    const interval = setInterval(() => {
      if (stepIdx < PROGRESS_STEPS.length) {
        setProgress(PROGRESS_STEPS[stepIdx].pct);
        setProgressLabel(PROGRESS_STEPS[stepIdx].label);
        stepIdx++;
      }
    }, 4500);

    const pd = profile.profile_data ?? {};

    try {
      const res = await fetch("/api/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: jdText,
          user_profile: {
            full_name: profile.full_name,
            email: profile.email,
            phone: profile.phone,
            current_city: profile.current_city,
            graduation_year: profile.graduation_year,
            target_roles: profile.target_roles,
            linkedin_data: profile.linkedin_data,
            // Rich profile fields from the editor
            summary: pd.summary,
            experience: pd.experience,
            skills: pd.skills,
            education: pd.education,
            projects: pd.projects,
          },
        }),
      });

      clearInterval(interval);
      const data = await res.json();

      if (res.status === 402) {
        const msg = data.reason === "CREDITS_EXHAUSTED"
          ? "You've used all credits in your plan."
          : "You need a paid plan to generate a resume.";
        setGenError(msg);
        toast.error(msg, { action: { label: "View plans", onClick: () => router.push("/pricing") }, duration: 5000 });
        setGenerating(false);
        setProgress(0);
        return;
      }

      if (!res.ok) {
        const msg = data.error || "Generation failed. Try again.";
        setGenError(msg);
        toast.error(msg);
        setGenerating(false);
        setProgress(0);
        return;
      }

      setProgress(100);
      setProgressLabel("Done! Saving your resume…");

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Session expired."); router.push("/login"); return; }

      const resumeJson = data.resume_json;
      const { data: savedResume, error: saveError } = await supabase
        .from("resumes")
        .insert({
          user_id: user.id,
          jd_text: jdText,
          resume_json: resumeJson,
          ats_score: resumeJson.ats_score,
          tailored_role: resumeJson.tailored_role,
          matched_keywords: resumeJson.matched_keywords,
          missing_keywords: resumeJson.missing_keywords,
        })
        .select("id")
        .single();

      if (saveError) {
        toast.error("Couldn't save resume: " + saveError.message);
        setGenerating(false);
        return;
      }

      router.push(`/preview/${savedResume.id}`);
    } catch (err) {
      clearInterval(interval);
      console.error(err);
      const msg = "Something went wrong. Please try again.";
      setGenError(msg);
      toast.error(msg);
      setGenerating(false);
      setProgress(0);
    }
  }

  const completeness = checkCompleteness(profile);
  const noPlan = planCheck && !planCheck.allowed;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <AppHeader />

      <div className="max-w-3xl mx-auto px-6 py-12">
        {!generating ? (
          <>
            <div className="mb-8">
              <h1 className="font-serif italic text-4xl text-[#1a1a1a] mb-3">Paste the job description</h1>
              <p className="text-[#6b6b6b]">
                Copy the full JD from Naukri, LinkedIn Jobs, or any company website.
              </p>
            </div>

            {/* Profile completeness gate */}
            {loaded && !completeness.complete && (
              <div className="mb-6 bg-white border border-stone-200 rounded-xl p-6 flex flex-col sm:flex-row items-center gap-5 shadow-sm">
                <div className="w-12 h-12 rounded-full bg-[#1f5c3a]/10 flex items-center justify-center shrink-0">
                  <UserCircle className="w-6 h-6 text-[#1f5c3a]" />
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <p className="font-semibold text-[#1a1a1a] mb-0.5">Finish your profile first</p>
                  <p className="text-sm text-[#6b6b6b]">
                    Missing: <span className="font-medium text-[#1a1a1a]">{completeness.missing}</span>.
                    The AI needs your experience or education to generate a tailored resume.
                  </p>
                </div>
                <Button asChild className="shrink-0">
                  <Link href="/profile">Edit profile →</Link>
                </Button>
              </div>
            )}

            {/* Plan banners */}
            {planCheck && !planCheck.allowed && planCheck.reason === "NO_PLAN" && (
              <div className="mb-5 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <span>You&apos;ll need a paid plan to generate a resume.</span>
                <Link href="/pricing" className="font-semibold underline underline-offset-2 whitespace-nowrap">View plans →</Link>
              </div>
            )}
            {planCheck && !planCheck.allowed && planCheck.reason === "CREDITS_EXHAUSTED" && (
              <div className="mb-5 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <span>You&apos;ve used all {planCheck.allotted} credits in your current plan.</span>
                <Link href="/pricing" className="font-semibold underline underline-offset-2 whitespace-nowrap">Buy another pack →</Link>
              </div>
            )}

            {genError && (
              <div className="mb-5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{genError}</div>
            )}

            <div className="flex flex-col gap-3">
              <Textarea
                placeholder="Paste the complete job description here — including responsibilities, requirements, and preferred skills…"
                className="min-h-[320px] text-sm leading-relaxed resize-none bg-white"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                disabled={generating}
              />
              <span className={`text-xs ${jdText.length < 200 ? "text-[#6b6b6b]" : "text-[#1f5c3a]"}`}>
                {jdText.length} characters {jdText.length < 200 ? `(need ${200 - jdText.length} more)` : "✓"}
              </span>
            </div>

            <div className="mt-6">
              <Button
                size="lg"
                onClick={handleGenerate}
                disabled={jdText.trim().length < 200 || generating || !!noPlan || !completeness.complete}
                className="w-full sm:w-auto text-base px-10"
              >
                Generate my resume →
              </Button>
              {profile && completeness.complete && (
                <p className="text-xs text-[#6b6b6b] mt-3">
                  Generating for <strong>{profile.full_name}</strong>
                  {profile.target_roles?.length ? ` · targeting ${profile.target_roles[0]}` : ""}
                  {planCheck?.allowed ? ` · ${planCheck.remaining} credit${planCheck.remaining !== 1 ? "s" : ""} remaining` : ""}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 text-center">
            <div className="w-full max-w-md">
              <h2 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">Building your resume…</h2>
              <p className="text-[#6b6b6b] text-sm mb-8">This takes about 25 seconds. Don&apos;t close this tab.</p>
              <Progress value={progress} className="h-2 mb-4" />
              <p className="text-sm text-[#1f5c3a] font-medium animate-pulse">{progressLabel}</p>
            </div>
            <div className="flex flex-col gap-2 text-xs text-[#6b6b6b] max-w-xs">
              <p>✦ Matching keywords from the JD</p>
              <p>✦ Rewriting bullets with action verbs</p>
              <p>✦ Calculating your ATS match score</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
