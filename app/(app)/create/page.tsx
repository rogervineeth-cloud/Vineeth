"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
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
    new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text)
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
  { label: "Reading your job descriptionâ¦", icon: "ð", pct: 8, ms: 3000 },
  { label: "Extracting key skills & keywordsâ¦", icon: "ð", pct: 25, ms: 9000 },
  { label: "Matching your experience to JDâ¦", icon: "ð§ ", pct: 45, ms: 13000 },
  { label: "Rewriting bullets with action verbsâ¦", icon: "âï¸", pct: 65, ms: 14000 },
  { label: "Calculating ATS match scoreâ¦", icon: "ð", pct: 82, ms: 10000 },
  { label: "Final polish & formattingâ¦", icon: "â¨", pct: 95, ms: 6000 },
];

// Racing checkpoint names for the racer play experience
const CHECKPOINT_NAMES = [
  "Grid start",
  "Turn 1",
  "Turn 2",
  "Straight",
  "Turn 3",
  "Final lap",
];

const WAIT_TIPS = [
  "ATS systems scan for exact keyword matches â the AI weaves yours in naturally.",
  "Tip: Action verbs like 'Led', 'Built', 'Scaled' get 23% more recruiter attention.",
  "Indian hiring managers prefer concise 1-page resumes. Yours will fit perfectly.",
  "87% of Indian hiring managers prefer resumes that mirror the JD language.",
  "Your resume will be optimised for Naukri, LinkedIn Jobs, and company ATSes.",
];

// ââ Score band helper âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function scoreBand(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: "Excellent match", color: "#1f5c3a", bg: "#1f5c3a" };
  if (score >= 65) return { label: "Good match", color: "#2d8a55", bg: "#2d7a48" };
  if (score >= 50) return { label: "Average match", color: "#b45309", bg: "#b45309" };
  return { label: "Low match", color: "#dc2626", bg: "#dc2626" };
}

// ââ Component ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

  // UI sta!te
  const [showMissingPopup, setShowMissingPopup] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [genStageIdx, setGenStageIdx] = useState(0);
  const [genProgress, setGenProgress] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);

  // Racer play state
  const [atsDisplayScore, setAtsDisplayScore] = useState(0);
  const [showFinish, setShowFinish] = useState(false);

  // Result
  const [generatedResume, setGeneratedResume] = useState<GeneratedResume | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<string | null>(null);

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
    const t = setTimeout(() => setJdAnalysis(analyzeJd(jdText)), 400);
    return () => clearTimeout(t);
  }, [jdText]);

  // ââ Rotating tips during generation ââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setTipIdx((i) => (i + 1) % WAIT_TIPS.length), 6000);
    return () => clearInterval(t);
  }, [generating]);

  // ââ ATS score count-up animation ââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    if (!generatedResume) {
      setAtsDisplayScore(0);
      setShowFinish(false);
      return;
    }
    // Brief "finish line" flash before result
    setShowFinish(true);
    const finishTimer = setTimeout(() => setShowFinish(false), 2000);

    // Count up the ATS score
    let current = 0;
    const target = generatedResume.ats_score;
    const increment = Math.ceil(target / 50);
    const countTimer = setInterval(() => {
      current = Math.min(current + increment, target);
      setAtsDisplayScore(current);
      if (current >= target) clearInterval(countTimer);
    }, 25);

    return () => {
      clearTimeout(finishTimer);
      clearInterval(countTimer);
    };
  }, [generatedResume]);

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
        const msg = data.error || "Generation failed. Try again.";
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

  // Stage the user is currently on
  const currentStage = generatedResume ? 3 : !jdReady ? 1 : !completeness.complete ? 2 : 3;

  // Car position along track (0â100%)
  const carPct = genProgress === 0 ? 0 : Math.max(genProgress - 3, 0);

  // ââ Render ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#f7f3ea]">
      <AppHeader />

      <div className="flex-1 flex overflow-hidden">
        {/* ââ LEFT PANEL ââ */}
        <div className="flex-1 flex flex-col overflow-y-auto p-6 lg:p-8 max-w-2xl">

          {/* Stage progress */}
          <div className="flex items-center gap-2 mb-8">
            {[
              { n: 1, label: "Job Description", done: jdReady },
              { n: 2, label: "Profile", done: completeness.complete },
              { n: 3, label: "Generate", done: !!generatedResume },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    s.done
                      ? "bg-[#1f5c3a] text-white"
                      : currentStage === s.n
                      ? "bg-[#1f5c3a]/10 text-[#1f5c3a] ring-1 ring-[#1f5c3a]/30"
                      : "bg-white/60 text-[#999]"
                  }`}
                >
                  {s.done ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <span>{s.n}</span>
                  )}
                  {s.label}
                </div>
                {i < 2 && <div className="w-5 h-px bg-[#d4c9b0]" />}
              </div>
            ))}
          </div>

          {/* Stage 1 â JD input */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-serif italic text-2xl text-[#1a1a1a]">
                Paste the job description
              </h2>
              {jdAnalysis.detectedRole && (
                <span className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full font-medium">
                  ð {jdAnalysis.detectedRole}
                </span>
              )}
            </div>
            <p className="text-sm text-[#6b6b6b] mb-3">
              Copy from Naukri, LinkedIn Jobs, or any company careers page.
            </p>

            <Textarea
              ref={jdRef as React.Ref<HTMLTextAreaElement>}
              placeholder="Paste the complete job description here â including responsibilities, requirements, and preferred skillsâ¦"
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
                  : `${jdText.length} characters â`}
              </span>
              {jdAnalysis.quality === "good" && (
                <span className="text-xs text-[#1f5c3a]">Detailed JD â</span>
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

          {/* Stage 2 â Profile status */}
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
                        ? `Profile ready â ${profile?.full_name}`
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
                          ? ` Â· ${planCheck.remaining} credit${planCheck.remaining !== 1 ? "s" : ""} left`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>
                <Link href="/profile">
                  <Button variant="outline" size="sm" className="text-xs h-7 shrink-0">
                    {completeness.complete ? "Edit" : "Fix now â"}
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
                {planCheck.reason === "NO_PLAN" ? "View plans â" : "Buy more â"}
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
              "Generatingâ¦"
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
            /* ââ RACER PLAY: Race track animation ââ */
            <div className="flex flex-col items-center justify-center h-full p-7 text-center">

              {/* Racing badge */}
              <div className="inline-flex items-center gap-1.5 bg-[#1f5c3a] text-white rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest mb-4">
                <span>ðï¸</span>
                <span>AI Race in Progress</span>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              </div>

              <h3 className="font-serif italic text-2xl text-[#1a1a1a] mb-1">
                Your resume is in the fast laneâ¦
              </h3>
              <p className="text-sm text-[#6b6b6b] mb-6">
                Checkpoint {genStageIdx + 1}/{GEN_STAGES.length} Â· Don&apos;t close this tab
              </p>

              {/* Race track progress bar */}
              <div className="w-full max-w-xs mb-1">
                <div className="flex justify-between text-xs text-[#9b9080] mb-2">
                  <span className="font-medium">ð Grid</span>
                  <span className="font-bold text-[#1f5c3a]">{genProgress}%</span>
                  <span className="font-medium">ð Finish</span>
                </div>

                {/* Track */}
                <div className="relative h-6 bg-[#f0ebe0] rounded-full border border-[#d4c9b0] overflow-visible">
                  {/* Track lane lines */}
                  <div className="absolute inset-0 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{
                        width: `${genProgress}%`,
                        background: "linear-gradient(90deg, #1f5c3a 0%, #2d8a55 60%, #3aaa6a 100%)",
                      }}
                    />
                  </div>

                  {/* Checkpoint markers on track */}
                  {GEN_STAGES.map((stage, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 w-px"
                      style={{
                        left: `${stage.pct}%`,
                        backgroundColor: i < genStageIdx
                          ? "rgba(255,255,255,0.4)"
                          : "rgba(180,160,120,0.4)",
                      }}
                    />
                  ))}

                  {/* Racing car â moves along track */}
                  <div
                    className="absolute top-1/2 transition-all duration-1000 ease-out z-10"
                    style={{
                      left: `${carPct}%`,
                      transform: "translateY(-50%) translateX(-50%)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "20px",
                        lineHeight: 1,
                        display: "block",
                        filter: "drop-shadow(1px 2px 3px rgba(0,0,0,0.25))",
                      }}
                    >
                      ðï¸
                    </span>
                  </div>
                </div>

                {/* Current stage label */}
                <div className="text-xs text-[#6b6b6b] text-center mt-2 h-4 truncate">
                  {GEN_STAGES[genStageIdx]?.label}
                </div>
              </div>

              {/* Checkpoint list */}
              <div className="w-full max-w-xs space-y-1.5 mt-4 mb-5">
                {GEN_STAGES.map((stage, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 text-xs rounded-lg px-3 py-2 transition-all duration-500 ${
                      i < genStageIdx
                        ? "bg-[#1f5c3a]/5 text-[#1f5c3a]"
                        : i === genStageIdx
                        ? "bg-[#1f5c3a]/10 text-[#1a1a1a] font-semibold ring-1 ring-[#1f5c3a]/20"
                        : "text-[#bbb]"
                    }`}
                  >
                    {/* Checkpoint number badge */}
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold transition-all duration-500 ${
                        i < genStageIdx
                          ? "bg-[#1f5c3a] text-white"
                          : i === genStageIdx
                          ? "bg-[#1f5c3a] text-white"
                          : "bg-[#e8e0d0] text-[#bbb]"
                      }`}
                    >
                      {i < genStageIdx ? "â" : i + 1}
                    </div>

                    {/* Label */}
                    <span className="flex-1 text-left">{stage.label}</span>

                    {/* Right-side indicator */}
                    {i < genStageIdx && (
                      <span className="text-[10px] text-[#1f5c3a] font-medium shrink-0">
                        {CHECKPOINT_NAMES[i]}
                      </span>
                    )}
                    {i === genStageIdx && (
                      <div className="w-2 h-2 rounded-full bg-[#1f5c3a] animate-ping shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {/* Pit crew intel */}
              <div className="w-full max-w-xs bg-[#f7f3ea] rounded-xl p-4 text-left border border-[#e8e0d0]">
                <p className="text-xs font-semibold text-[#1a1a1a] mb-1.5 flex items-center gap-1.5">
                  <span>ð§</span>
                  <span>Pit Crew Intel</span>
                </p>
                <p className="text-xs text-[#6b6b6b] leading-relaxed transition-all duration-700">
                  {WAIT_TIPS[tipIdx]}
                </p>
              </div>
            </div>

          ) : generatedResume ? (
            /* ââ Result panel with finish line celebration ââ */
            <div className="flex flex-col p-7 h-full">

              {/* Finish line flash overlay */}
              {showFinish && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-white/95 rounded-r-none animate-in fade-in duration-300">
                  <div className="text-5xl mb-3">ð</div>
                  <h3 className="font-serif italic text-2xl text-[#1a1a1a] text-center">
                    You crossed the finish line!
                  </h3>
                  <p className="text-sm text-[#6b6b6b] mt-2 text-center">
                    Resume built in record time ð
                  </p>
                </div>
              )}

              {/* Result header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-[#1f5c3a] flex items-center justify-center shrink-0 text-lg">
                  ð
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] text-sm leading-tight">
                    Resume ready!
                  </p>
                  <p className="text-xs text-[#6b6b6b]">
                    Tailored for {generatedResume.tailored_role}
                  </p>
                </div>
              </div>

              {/* ATS Score â animated count-up */}
              {(() => {
                const band = scoreBand(generatedResume.ats_score);
                return (
                  <div
                    className="text-white rounded-2xl p-5 mb-4 transition-all duration-500"
                    style={{ backgroundColor: band.bg }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs opacity-70 uppercase tracking-wider font-medium">
                        ATS Match Score
                      </p>
                      <span className="text-xs font-semibold bg-white/20 px-2 py-0.5 rounded-full">
                        {band.label}
                      </span>
                    </div>
                    <div className="flex items-end gap-1.5 mb-3">
                      <span
                        className="font-serif italic leading-none tabular-nums"
                        style={{ fontSize: "56px" }}
                      >
                        {atsDisplayScore}
                      </span>
                      <span className="text-2xl opacity-50 pb-2">/100</span>
                    </div>
                    {/* Score bar */}
                    <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${atsDisplayScore}%` }}
                      />
                    </div>
                    {/* Checkpoint markers on score bar */}
                    <div className="flex justify-between mt-1.5">
                      {[25, 50, 75].map((pct) => (
                        <div
                          key={pct}
                          className="text-[10px] opacity-50"
                          style={{ marginLeft: `${pct - 12.5}%` }}
                        >
                          |
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Matched keywords */}
              {generatedResume.matched_keywords.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[#1a1a1a] mb-2">
                    â Keywords matched ({generatedResume.matched_keywords.length})
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
                    â  Consider adding ({generatedResume.missing_keywords.length})
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
                <p className="t%xt-xs font-semibold text-[#1a1a1a] mb-1.5">
                  ð AI-written summary
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
                  View &amp; download PDF â
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
                Paste a job description and click Generate â your AI-tailored
                resume will appear here.
              </p>

              <div className="mt-8 w-full space-y-3">
                {[
                  {
                    icon: "ð¯",
                    title: "JD-matched keywords",
                    desc: "The AI picks the exact phrases recruiters search for",
                  },
                  {
                    icon: "âï¸",
                    title: "Rewritten bullets",
                    desc: "Your experience, worded to win ATS scans",
                  },
                  {
                    icon: "ð",
                    title: "ATS score",
                    desc: "Know exactly how you rank before applying",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="flex items-start gap-3 text-left bg-white/70 rounded-xl p-3.5 border border-[#e8e0d0]"
                  >
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <p className="text-xs font-semibold text-[#1a1a1a]">
                        {item.title}
                      </p>
                      <p className="text-xs text-[#9b9080] mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
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
