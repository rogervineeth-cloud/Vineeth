"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import MagicReveal from "@/components/generation/MagicReveal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AppHeader } from "@/components/app-header";
import { CheckCircle2, AlertCircle, Sparkles, FileText } from "lucide-react";

// ââ Types âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

type ProfileData = {
  summary?: string;
  experience?: Array<{
    company: string;
    role: string;
    duration: string;
    location: string;
    bullets: string[];
  }>;
  skills?: string[];
  education?: Array<{
    institution: string;
    degree: string;
    year: string;
    location: string;
    cgpa?: string;
  }>;
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

type JdAnalysis = {
  detectedRole: string | null;
  keywords: string[];
  quality: "weak" | "ok" | "good";
};

type GeneratedResume = {
  ats_score: number;
  tailored_role: string;
  matched_keywords: string[];
  missing_keywords: string[];
  summary: string;
};

// ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const TECH_SKILLS = [
  "React", "Node.js", "Python", "Java", "TypeScript", "JavaScript", "AWS",
  "Docker", "Kubernetes", "SQL", "MongoDB", "GraphQL", "REST API", "Git",
  "CI/CD", "Linux", "Excel", "Power BI", "Tableau", "Machine Learning",
  "Deep Learning", "TensorFlow", "PyTorch", "NLP", "Data Analysis", "Agile",
  "Scrum", "Product Management", "Figma", "UI/UX", "Angular", "Vue.js",
  "Spring Boot", "Django", "FastAPI", "Salesforce", "SAP", "JIRA",
  "Google Analytics", "SEO", "Next.js", "PostgreSQL", "MySQL", "Firebase",
  "Redis", "Kafka", "Elasticsearch", "Go", "Rust", "C++", "Terraform",
];

function analyzeJd(text: string): JdAnalysis {
  if (text.length < 100) {
    return { detectedRole: null, keywords: [], quality: "weak" };
  }

  const found = TECH_SKILLS.filter((skill) =>
    new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
  );

  const roleMatch = text.match(
    /(?:role|position|title)[:\s]+([A-Za-z][A-Za-z\s]+(?:Engineer|Developer|Manager|Analyst|Designer|Consultant|Lead|Specialist|Associate|Executive|Director|Architect))/i
  );
  const detectedRole = roleMatch ? roleMatch[1].trim().slice(0, 40) : null;

  const quality =
    text.length < 300 ? "weak" : text.length < 800 ? "ok" : "good";

  return { detectedRole, keywords: found.slice(0, 12), quality };
}

function checkCompleteness(profile: Profile | null): {
  complete: boolean;
  missing: string;
} {
  if (!profile) return { complete: false, missing: "your profile" };
  if (!profile.full_name?.trim()) return { complete: false, missing: "your name" };
  if (!profile.target_roles?.length)
    return { complete: false, missing: "target roles" };
  const pd = profile.profile_data;
  if (!(pd?.experience?.length ?? 0) && !(pd?.education?.length ?? 0))
    return { complete: false, missing: "experience or education" };
  return { complete: true, missing: "" };
}

// ââ Generation stages (total ~55 seconds) ââââââââââââââââââââââââââââââââââââ

const GEN_STAGES = [
  { label: "Reading your job description…", icon: "📖", pct: 8, ms: 3000 },
  { label: "Extracting key skills & keywords…", icon: "🔍", pct: 25, ms: 9000 },
  { label: "Matching your experience to JD…", icon: "🤝", pct: 45, ms: 13000 },
  { label: "Rewriting bullets with action verbs…", icon: "✍️", pct: 65, ms: 14000 },
  { label: "Calculating ATS match score…", icon: "📊", pct: 82, ms: 10000 },
  { label: "Final polish & formatting…", icon: "✨", pct: 95, ms: 6000 },
];

const WAIT_TIPS = [
  "ATS systems scan for exact keyword matches — the AI weaves yours in naturally.",
  "Tip: Action verbs like 'Led', 'Built', 'Scaled' get 23% more recruiter attention.",
  "Indian hiring managers prefer concise 1-page resumes. Yours will fit perfectly.",
  "87% of Indian hiring managers prefer resumes that mirror the JD language.",
  "Your resume will be optimised for Naukri, LinkedIn Jobs, and company ATSes.",
];

// ââ Component âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export default function CreatePage() {
  const router = useRouter();
  const jdRef = useRef<HTMLTextAreaElement>(null);

  // Data
  const [profile, setProfile] = useState<Profile | null>(null);
  const [planCheck, setPlanCheck] = useState<PlanCheck | null>(null);
  const [loaded, setLoaded] = useState(false);

  // JD state
  const [jdText, setJdText] = useState("");
  const [jdAnalysis, setJdAnalysis] = useState<JdAnalysis>({
    detectedRole: null,
    keywords: [],
    quality: "weak",
  });

  // UI state
  const [showMissingPopup, setShowMissingPopup] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [genStageIdx, setGenStageIdx] = useState(0);
  const [genProgress, setGenProgress] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [showRevealDone, setShowRevealDone] = useState(false);

  // Result
  const [generatedResume, setGeneratedResume] = useState<GeneratedResume | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<string | null>(null);

  // MagicReveal done: hide the completed reveal after a short display
  useEffect(() => {
    if (!showRevealDone) return;
    const t = setTimeout(() => setShowRevealDone(false), 3500);
    return () => clearTimeout(t);
  }, [showRevealDone]);

  // ââ Load profile & plan âââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const [profileRes, plansRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).single(),
        supabase
          .from("user_plans")
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
        setPlanCheck({ allowed: false, reason: "CREDITS_EXHAUSTED", allotted: plans[0].resumes_allotted });
      } else {
        setPlanCheck({ allowed: false, reason: "NO_PLAN", allotted: 0 });
      }
      setLoaded(true);
    });
  }, []);

  // ââ Live JD analysis âââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    localStorage.setItem("ndrs_jd", jdText);
  }, [jdText]);

  useEffect(() => {
    const t = setTimeout(() => setJdAnalysis(analyzeJd(jdText)), 400);
    return () => clearTimeout(t);
  }, [jdText]);

  // ââ Rotating tips during generation ââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setTipIdx((i) => (i + 1) % WAIT_TIPS.length), 6000);
    return () => clearInterval(t);
  }, [generating]);

  // ââ Generate handler ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  async function handleGenerate() {
    const completeness = checkCompleteness(profile);
    if (!completeness.complete) {
      setShowMissingPopup(true);
      return;
    }
    if (jdText.trim().length < 200) {
      toast.error("Please paste a longer job description (min 200 characters).");
      jdRef.current?.focus();
      return;
    }
    if (planCheck && !planCheck.allowed) {
      toast.error(
        planCheck.reason === "NO_PLAN"
          ? "You need a paid plan to generate a resume."
          : "You've used all credits in your current plan.",
        {
          action: { label: "View plans", onClick: () => router.push("/pricing") },
          duration: 5000,
        }
      );
      return;
    }

    setGenerating(true);
    setGenError(null);
    setGenStageIdx(0);
    setGenProgress(3);
    setGeneratedResume(null);
    setSavedResumeId(null);

    // Animate through stages
    let accumulated = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    GEN_STAGES.forEach((stage, idx) => {
      timers.push(
        setTimeout(() => {
          setGenStageIdx(idx);
          setGenProgress(stage.pct);
        }, accumulated)
      );
      accumulated += stage.ms;
    });

    const pd = profile!.profile_data ?? {};
    try {
      const res = await fetch("/api/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: jdText,
          user_profile: {
            full_name: profile!.full_name,
            email: profile!.email,
            phone: profile!.phone,
            current_city: profile!.current_city,
            graduation_year: profile!.graduation_year,
            target_roles: profile!.target_roles,
            linkedin_data: profile!.linkedin_data,
            summary: pd.summary,
            experience: pd.experience,
            skills: pd.skills,
            education: pd.education,
            projects: pd.projects,
          },
        }),
      });

      timers.forEach(clearTimeout);
      const data = await res.json();

      if (res.status === 402) {
        const msg =
          data.reason === "CREDITS_EXHAUSTED"
            ? "You've used all credits in your plan."
            : "You need a paid plan to generate a resume.";
        setGenError(msg);
        toast.error(msg, {
          action: { label: "View plans", onClick: () => router.push("/pricing") },
        });
        setGenerating(false);
        setGenProgress(0);
        return;
      }

      if (!res.ok) {
        const rawMsg = data.error || "Generation failed. Try again.";
        const msg = data.code === "AI_PARSE_ERROR" || (rawMsg && rawMsg.toLowerCase().includes("parse"))
          ? "We hit a glitch drafting your resume. Please try once more."
          : rawMsg;
        setGenError(msg);
        toast.error(msg);
        setGenerating(false);
        setGenProgress(0);
        return;
      }

      setGenStageIdx(GEN_STAGES.length - 1);
      setGenProgress(100);

      // Save to Supabase
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Session expired.");
        router.push("/login");
        return;
      }

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

      // Show result in right panel
      setGeneratedResume({
        ats_score: resumeJson.ats_score,
        tailored_role: resumeJson.tailored_role,
        matched_keywords: resumeJson.matched_keywords ?? [],
        missing_keywords: resumeJson.missing_keywords ?? [],
        summary: resumeJson.summary ?? "",
      });
      setSavedResumeId(savedResume.id);
      setShowRevealDone(true);
      setGenerating(false);
    } catch (err) {
      timers.forEach(clearTimeout);
      console.error(err);
      const msg = "Something went wrong. Please try again.";
      setGenError(msg);
      toast.error(msg);
      setGenerating(false);
      setGenProgress(0);
    }
  }

  // ââ Derived state âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const completeness = checkCompleteness(profile);
  const jdReady = jdText.trim().length >= 200;
  const canGenerate =
    jdReady &&
    completeness.complete &&
    (!planCheck || planCheck.allowed) &&
    !generating;

  const revealStage = Math.min(genStageIdx + 1, 4) as 1 | 2 | 3 | 4;
  const currentGenStage = GEN_STAGES[genStageIdx] ?? GEN_STAGES[GEN_STAGES.length - 1];

  // Stage the user is currently on
  const currentStage = generatedResume ? 3 : !jdReady ? 1 : !completeness.complete ? 2 : 3;

  // ââ Render ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f7f3ea]">
      <AppHeader />

      <div className="flex-1 flex overflow-hidden min-h-0 w-full max-w-7xl mx-auto">
        {/* ââ LEFT PANEL ââ */}
        <div className="flex-1 flex flex-col overflow-y-auto min-h-0 p-6 lg:p-8 max-w-2xl">

          {/* Stage progress */}
          <div className="flex items-center gap-2 mb-8">
            {[
              { n: 1, label: "Job Description", done: jdReady },
              { n: 2, label: "Profile", done: completeness.complete },
              { n: 3, label: "Generate", done: !!generatedResume },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    s.done
                      ? "bg-[#1f5c3a] text-white"
                      : currentStage === s.n
                      ? "bg-[#1f5c3a]/10 text-[#1f5c3a] ring-1 ring-[#1f5c3a]/30"
                      : "bg-white/60 text-[#999]"
                  }`}
                >
                  <span className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-[0.65rem] ${
                    s.done
                      ? "bg-white/20 text-white"
                      : currentStage === s.n
                      ? "bg-[#1f5c3a] text-white"
                      : "bg-white text-[#999]"
                  }`}>
                    {s.done ? <CheckCircle2 className="w-3 h-3" /> : s.n}
                  </span>
                  {s.label}
                </div>
                {i < 2 && <div className="w-5 h-px bg-[#d4c9b0]" />}
              </div>
            ))}
          </div>

          {/* Stage 1 — JD input */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-serif italic text-2xl text-[#1a1a1a]">
                Paste the job description
              </h2>
              {jdAnalysis.detectedRole && (
                <span className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full font-medium">
                  📌 {jdAnalysis.detectedRole}
                </span>
              )}
            </div>
            <p className="text-sm text-[#6b6b6b] mb-3">
              Copy from Naukri, LinkedIn Jobs, or any company careers page.
            </p>

            <Textarea
              ref={jdRef as React.Ref<HTMLTextAreaElement>}
              placeholder="Paste the complete job description here, including responsibilities, requirements, and preferred skills."
              className="min-h-[200px] text-sm leading-relaxed resize-none bg-white"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              disabled={generating}
            />

            {/* Character counter */}
            <div className="flex items-center justify-between mt-1.5">
              <span
                className={`text-xs ${
                  jdReady ? "text-[#1f5c3a] font-medium" : "text-[#999]"
                }`}
              >
                {jdText.length < 200
                  ? `${jdText.length}/200 characters minimum`
                  : `${jdText.length} characters ✓`}
              </span>
              {jdAnalysis.quality === "good" && (
                <span className="text-xs text-[#1f5c3a]">Detailed JD ✓</span>
              )}
            </div>

            {/* Live keyword chips */}
            {jdAnalysis.keywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-[#6b6b6b]">Detected skills:</span>
                {jdAnalysis.keywords.slice(0, 8).map((kw) => (
                  <span
                    key={kw}
                    className="text-xs bg-white border border-[#1f5c3a]/25 text-[#1f5c3a] px-2 py-0.5 rounded-full"
                  >
                    {kw}
                  </span>
                ))}
                {jdAnalysis.keywords.length > 8 && (
                  <span className="text-xs text-[#999]">
                    +{jdAnalysis.keywords.length - 8} more
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Stage 2 — Profile status */}
          {loaded && (
            <div
              className={`mb-6 rounded-xl p-4 border ${
                completeness.complete
                  ? "bg-[#1f5c3a]/5 border-[#1f5c3a]/20"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {completeness.complete ? (
                    <CheckCircle2 className="w-4 h-4 text-[#1f5c3a] shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-[#1a1a1a]">
                      {completeness.complete
                        ? `Profile ready — ${profile?.full_name}`
                        : "Profile incomplete"}
                    </p>
                    {!completeness.complete && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        Missing: {completeness.missing}
                      </p>
                    )}
                    {completeness.complete && profile?.target_roles?.length && (
                      <p className="text-xs text-[#6b6b6b] mt-0.5">
                        Targeting:{" "}
                        {profile.target_roles.slice(0, 2).join(", ")}
                        {planCheck?.allowed
                          ? ` • ${planCheck.remaining} credit${planCheck.remaining !== 1 ? "s" : ""} left`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>
                <Link href="/profile">
                  <Button variant="outline" size="sm" className="text-xs h-7 shrink-0">
                    {completeness.complete ? "Edit" : "Fix now →"}
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* Plan warning */}
          {planCheck && !planCheck.allowed && (
            <div className="mb-5 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <span>
                {planCheck.reason === "NO_PLAN"
                  ? "You need a paid plan to generate."
                  : `All ${planCheck.allotted} credits used.`}
              </span>
              <Link
                href="/pricing"
                className="font-semibold underline underline-offset-2 whitespace-nowrap"
              >
                {planCheck.reason === "NO_PLAN" ? "View plans →" : "Buy more →"}
              </Link>
            </div>
          )}

          {genError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {genError}
            </div>
          )}

          {/* Generate button */}
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full text-base py-6 rounded-xl font-semibold"
          >
            {generating ? (
              "Generating…"
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate my resume
              </>
            )}
          </Button>

          {!jdReady && !generating && (
            <p className="text-xs text-center text-[#999] mt-2">
              Paste a job description above to continue
            </p>
          )}
        </div>

        {/* ââ RIGHT PANEL ââ */}
        <div className="hidden lg:flex flex-col w-[460px] border-l border-[#e8e0d0] bg-white/40 overflow-y-auto">

          {generating ? (
            <div className="flex flex-col h-full">
              <div className="px-7 pt-7">
                <div className="mb-3 flex items-center justify-between text-xs text-[#6b6b6b]">
                  <span>{currentGenStage.label}</span>
                  <span>{genProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-[#e8e0d0] overflow-hidden">
                  <div
                    className="h-full bg-[#1f5c3a] transition-all duration-300"
                    style={{ width: `${genProgress}%` }}
                  />
                </div>
                <p className="mt-3 text-xs italic text-[#6b6b6b]">
                  {WAIT_TIPS[tipIdx]}
                </p>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <MagicReveal stage={revealStage} atsScore={null} />
              </div>
            </div>
          ) : showRevealDone ? (
              <MagicReveal stage="done" atsScore={generatedResume?.ats_score ?? null} />
            ) : generatedResume ? (
            /* ââ Result panel ââ */
            <div className="flex flex-col p-7 h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-[#1f5c3a] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] text-sm">
                    Resume ready!
                  </p>
                  <p className="text-xs text-[#6b6b6b]">
                    Tailored for {generatedResume.tailored_role}
                  </p>
                </div>
              </div>

              {/* ATS Score */}
              <div className="bg-[#1f5c3a] text-white rounded-2xl p-5 mb-4">
                <p className="text-xs opacity-70 mb-0.5">ATS Match Score</p>
                <div className="flex items-end gap-1.5">
                  <span className="font-serif italic text-5xl">
                    {generatedResume.ats_score}
                  </span>
                  <span className="text-xl opacity-50 pb-1">/100</span>
                </div>
                <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-1000"
                    style={{ width: `${generatedResume.ats_score}%` }}
                  />
                </div>
              </div>

              {/* Matched keywords */}
              {generatedResume.matched_keywords.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[#1a1a1a] mb-2">
                    ✓ Keywords matched ({generatedResume.matched_keywords.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {generatedResume.matched_keywords.slice(0, 8).map((kw) => (
                      <span
                        key={kw}
                        className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing keywords */}
              {generatedResume.missing_keywords.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[#1a1a1a] mb-2">
                    ⚠ Consider adding ({generatedResume.missing_keywords.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {generatedResume.missing_keywords.map((kw) => (
                      <span
                        key={kw}
                        className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Summary */}
              <div className="bg-[#f7f3ea] rounded-xl p-4 mb-5 flex-1 overflow-hidden">
                <p className="text-xs font-semibold text-[#1a1a1a] mb-1.5">
                  📝 AI-written summary
                </p>
                <p className="text-xs text-[#6b6b6b] leading-relaxed line-clamp-5">
                  {generatedResume.summary}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => router.push(`/preview/${savedResumeId}`)}
                >
                  View & download PDF →
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    setGeneratedResume(null);
                    setSavedResumeId(null);
                    setJdText("");
                    setGenProgress(0);
                    setGenStageIdx(0);
                  }}
                >
                  Generate another
                </Button>
              </div>
            </div>

          ) : (
            /* ââ Idle / preview hint ââ */
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-[#f7f3ea] border-2 border-dashed border-[#d4c9b0] flex items-center justify-center mb-5">
                <FileText className="w-8 h-8 text-[#c0b898]" />
              </div>
              <h3 className="font-serif italic text-xl text-[#1a1a1a] mb-2">
                Your resume preview
              </h3>
              <p className="text-sm text-[#9b9080] max-w-xs">
                Paste a job description and click Generate — your AI-tailored
                resume will appear here.
              </p>

            </div>
          )}
        </div>
      </div>

      {/* ââ Missing profile popup ââ */}
      {showMissingPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-[#1a1a1a] text-lg mb-1">
              Profile needs attention
            </h3>
            <p className="text-sm text-[#6b6b6b] mb-5">
              The AI needs your{" "}
              <span className="font-medium text-[#1a1a1a]">
                {completeness.missing}
              </span>{" "}
              to create a tailored resume.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                onClick={() => {
                  setShowMissingPopup(false);
                  router.push("/profile");
                }}
              >
                Complete my profile â
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowMissingPopup(false)}
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
