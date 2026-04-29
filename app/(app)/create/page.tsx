"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import MagicReveal from "@/components/generation/MagicReveal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertCircle, Sparkles, FileText, ChevronLeft } from "lucide-react";

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
  profile_improvement_tips?: string[];
  growth_note?: string | null;
  section_order?: string[];
};

// Each entry is the canonical skill name. `aliases` are alternative
// spellings/synonyms users commonly write in JDs (case-insensitive).
// Match logic uses a custom boundary so short tokens like "Go" do NOT
// match inside "go-to-market", and so hyphens/dots inside identifiers
// (e.g. "Node.js", "C++", "A/B testing") are preserved correctly.
const TECH_SKILLS: { name: string; aliases?: string[] }[] = [
    // Languages & runtimes
  { name: "JavaScript", aliases: ["JS", "ES6", "ECMAScript"] },
  { name: "TypeScript", aliases: ["TS"] },
  { name: "Python" },
  { name: "Java" },
  { name: "Kotlin" },
  { name: "Swift" },
  { name: "Objective-C" },
  { name: "Go", aliases: ["Golang"] },
  { name: "Rust" },
  { name: "C++" },
  { name: "C#" },
  { name: "Ruby" },
  { name: "PHP" },
  { name: "Scala" },
    // Web / frontend
  { name: "React", aliases: ["React.js", "ReactJS"] },
  { name: "Next.js", aliases: ["NextJS"] },
  { name: "Angular" },
  { name: "Vue.js", aliases: ["Vue", "VueJS"] },
  { name: "Node.js", aliases: ["NodeJS"] },
  { name: "HTML" },
  { name: "CSS" },
  { name: "Tailwind", aliases: ["TailwindCSS", "Tailwind CSS"] },
    // Mobile
  { name: "iOS", aliases: ["iPhone", "iPadOS"] },
  { name: "Android" },
  { name: "React Native" },
  { name: "Flutter" },
    // Backend / APIs
  { name: "GraphQL" },
  { name: "REST API", aliases: ["REST", "RESTful API", "RESTful"] },
  { name: "gRPC" },
  { name: "Spring Boot" },
  { name: "Django" },
  { name: "FastAPI" },
  { name: "Flask" },
  { name: "Express", aliases: ["Express.js"] },
    // Cloud & infra
  { name: "AWS", aliases: ["Amazon Web Services"] },
  { name: "Azure", aliases: ["Microsoft Azure"] },
  { name: "GCP", aliases: ["Google Cloud", "Google Cloud Platform"] },
  { name: "Docker" },
  { name: "Kubernetes", aliases: ["K8s"] },
  { name: "Terraform" },
  { name: "CI/CD", aliases: ["Continuous Integration", "Continuous Delivery", "Continuous Deployment"] },
  { name: "Linux" },
  { name: "Git" },
    // Data
  { name: "SQL" },
  { name: "PostgreSQL", aliases: ["Postgres"] },
  { name: "MySQL" },
  { name: "MongoDB" },
  { name: "Redis" },
  { name: "Kafka" },
  { name: "Elasticsearch", aliases: ["Elastic Search", "ELK"] },
  { name: "Firebase" },
  { name: "Snowflake" },
  { name: "BigQuery" },
  { name: "Airflow" },
    // Analytics & BI
  { name: "Excel" },
  { name: "Power BI" },
  { name: "Tableau" },
  { name: "Looker" },
  { name: "Mixpanel" },
  { name: "Amplitude" },
  { name: "Google Analytics", aliases: ["GA4"] },
  { name: "SQL Server" },
    // ML / AI
  { name: "Machine Learning", aliases: ["ML"] },
  { name: "Deep Learning" },
  { name: "TensorFlow" },
  { name: "PyTorch" },
  { name: "NLP", aliases: ["Natural Language Processing"] },
  { name: "Computer Vision" },
  { name: "LLM", aliases: ["Large Language Model", "Large Language Models", "GPT"] },
  { name: "Data Analysis" },
    // Process & ways of working
  { name: "Agile" },
  { name: "Scrum" },
  { name: "Kanban" },
    // Product & design
  { name: "Product Management" },
  { name: "Product Strategy" },
  { name: "Roadmapping", aliases: ["Roadmap"] },
  { name: "A/B Testing", aliases: ["AB Testing", "Experimentation", "Split Testing"] },
  { name: "User Research" },
  { name: "Stakeholder Management" },
  { name: "Go-to-Market", aliases: ["GTM"] },
  { name: "OKRs" },
  { name: "Figma" },
  { name: "Sketch" },
  { name: "UI/UX", aliases: ["UX", "UI"] },
    // Enterprise / SaaS
  { name: "Salesforce" },
  { name: "SAP" },
  { name: "JIRA" },
  { name: "Confluence" },
  { name: "Notion" },
  { name: "Slack" },
    // Marketing
  { name: "SEO" },
  { name: "SEM" },
  { name: "Performance Marketing" },
    // Other / misc
  { name: "Technical Writing" },
  ];

// Build a flat list of patterns we test against the JD text. Map each
// match back to the canonical skill name so aliases collapse correctly.
const TECH_SKILL_PATTERNS: { canonical: string; pattern: string }[] = (() => {
    const out: { canonical: string; pattern: string }[] = [];
    for (const s of TECH_SKILLS) {
          out.push({ canonical: s.name, pattern: s.name });
          for (const a of s.aliases ?? []) out.push({ canonical: s.name, pattern: a });
    }
    return out;
})();

// Custom word boundary: a "tech token" can include letters, digits,
// `+`, `#`, `.`, `/`, and `-`. We refuse to match if the character
// immediately before/after the candidate is one of those — this stops
// "Go" from matching inside "go-to-market" while still letting
// "Node.js", "C++", "A/B Testing", "CI/CD" match correctly.
const SKILL_BOUNDARY_CHARS = "A-Za-z0-9+#./\\-";

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function analyzeJd(text: string): JdAnalysis {
    if (text.length < 100) {
          return { detectedRole: null, keywords: [], quality: "weak" };
    }
    const seen = new Set<string>();
    const found: string[] = [];
    for (const p of TECH_SKILL_PATTERNS) {
          const re = new RegExp(
                  `(?<![${SKILL_BOUNDARY_CHARS}])${escapeRegex(p.pattern)}(?![${SKILL_BOUNDARY_CHARS}])`,
                  "i"
                );
          if (re.test(text) && !seen.has(p.canonical)) {
                  seen.add(p.canonical);
                  found.push(p.canonical);
          }
    }
    const roleMatch = text.match(
          /(?:role|position|title)[:\s]+([A-Za-z][A-Za-z\s]+(?:Engineer|Developer|Manager|Analyst|Designer|Consultant|Lead|Specialist|Associate|Executive|Director|Architect))/i
        );
    const detectedRole = roleMatch ? roleMatch[1].trim().slice(0, 40) : null;
    // Quality is now driven both by length AND signal density: a long JD
    // with no recognized skills is still treated as "weak" so we surface
    // a warning to the user instead of a falsely-confident green tick.
    let quality: JdAnalysis["quality"];
    if (text.length < 300 || found.length < 2) quality = "weak";
    else if (text.length < 800 || found.length < 5) quality = "ok";
    else quality = "good";
    return { detectedRole, keywords: found.slice(0, 12), quality };
}


function checkCompleteness(profile: Profile | null): { complete: boolean; missing: string } {
  if (!profile) return { complete: false, missing: "your profile" };
  if (!profile.full_name?.trim()) return { complete: false, missing: "your name" };
  if (!profile.target_roles?.length) return { complete: false, missing: "target roles" };
  const pd = profile.profile_data;
  if (!(pd?.experience?.length ?? 0) && !(pd?.education?.length ?? 0))
    return { complete: false, missing: "experience or education" };
  return { complete: true, missing: "" };
}

type TemplateId = "classic" | "modern" | "compact" | "executive";

const TEMPLATES: { id: TemplateId; label: string; description: string; svg: React.ReactNode }[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Clean & traditional",
    svg: (
      <svg viewBox="0 0 40 52" className="w-full h-full">
        <rect x="2" y="2" width="36" height="6" rx="1" fill="#1f5c3a" opacity="0.5" />
        <rect x="2" y="11" width="36" height="1" rx="0.5" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="14" width="28" height="1.5" rx="0.5" fill="#888" opacity="0.5" />
        <rect x="2" y="17" width="22" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="2" y="22" width="36" height="1" rx="0.5" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="25" width="30" height="1.5" rx="0.5" fill="#888" opacity="0.45" />
        <rect x="2" y="28" width="26" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="2" y="31" width="20" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
        <rect x="2" y="36" width="36" height="1" rx="0.5" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="39" width="24" height="1.5" rx="0.5" fill="#888" opacity="0.45" />
        <rect x="2" y="42" width="18" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
      </svg>
    ),
  },
  {
    id: "modern",
    label: "Modern",
    description: "Two-column layout",
    svg: (
      <svg viewBox="0 0 40 52" className="w-full h-full">
        <rect x="0" y="0" width="12" height="52" fill="#1f5c3a" opacity="0.1" />
        <rect x="1.5" y="4" width="9" height="3" rx="0.5" fill="#1f5c3a" opacity="0.4" />
        <rect x="1.5" y="10" width="9" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="1.5" y="13" width="7" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
        <rect x="1.5" y="19" width="9" height="1.5" rx="0.5" fill="#1f5c3a" opacity="0.35" />
        <rect x="1.5" y="22" width="6" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
        <rect x="1.5" y="25" width="8" height="1.5" rx="0.5" fill="#888" opacity="0.3" />
        <rect x="15" y="3" width="23" height="5" rx="0.5" fill="#1f5c3a" opacity="0.4" />
        <rect x="15" y="11" width="23" height="1.5" rx="0.5" fill="#888" opacity="0.45" />
        <rect x="15" y="14" width="19" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="15" y="17" width="16" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
        <rect x="15" y="22" width="23" height="1" rx="0.5" fill="#1f5c3a" opacity="0.25" />
        <rect x="15" y="25" width="20" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="15" y="28" width="17" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
        <rect x="15" y="35" width="23" height="1" rx="0.5" fill="#1f5c3a" opacity="0.25" />
        <rect x="15" y="38" width="18" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="15" y="41" width="14" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
      </svg>
    ),
  },
  {
    id: "compact",
    label: "Compact",
    description: "Dense, info-rich",
    svg: (
      <svg viewBox="0 0 40 52" className="w-full h-full">
        <rect x="2" y="2" width="36" height="4" rx="0.5" fill="#1f5c3a" opacity="0.5" />
        <rect x="2" y="8" width="36" height="1" rx="0.3" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="10.5" width="28" height="1" rx="0.3" fill="#888" opacity="0.45" />
        <rect x="2" y="12.5" width="22" height="1" rx="0.3" fill="#888" opacity="0.4" />
        <rect x="2" y="14.5" width="18" height="1" rx="0.3" fill="#888" opacity="0.35" />
        <rect x="2" y="17" width="36" height="1" rx="0.3" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="19.5" width="26" height="1" rx="0.3" fill="#888" opacity="0.45" />
        <rect x="2" y="21.5" width="20" height="1" rx="0.3" fill="#888" opacity="0.4" />
        <rect x="2" y="23.5" width="24" height="1" rx="0.3" fill="#888" opacity="0.35" />
        <rect x="2" y="26" width="36" height="1" rx="0.3" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="28.5" width="30" height="1" rx="0.3" fill="#888" opacity="0.45" />
        <rect x="2" y="30.5" width="24" height="1" rx="0.3" fill="#888" opacity="0.4" />
        <rect x="2" y="32.5" width="18" height="1" rx="0.3" fill="#888" opacity="0.35" />
        <rect x="2" y="35" width="36" height="1" rx="0.3" fill="#1f5c3a" opacity="0.3" />
        <rect x="2" y="37.5" width="22" height="1" rx="0.3" fill="#888" opacity="0.45" />
        <rect x="2" y="39.5" width="18" height="1" rx="0.3" fill="#888" opacity="0.4" />
        <rect x="2" y="41.5" width="26" height="1" rx="0.3" fill="#888" opacity="0.35" />
        <rect x="2" y="44" width="20" height="1" rx="0.3" fill="#888" opacity="0.3" />
      </svg>
    ),
  },
  {
    id: "executive",
    label: "Executive",
    description: "Bold dark header",
    svg: (
      <svg viewBox="0 0 40 52" className="w-full h-full">
        <rect x="0" y="0" width="40" height="12" fill="#1f5c3a" opacity="0.65" />
        <rect x="4" y="3" width="20" height="3" rx="0.5" fill="white" opacity="0.7" />
        <rect x="4" y="8" width="12" height="2" rx="0.5" fill="white" opacity="0.4" />
        <rect x="2" y="16" width="36" height="1.5" rx="0.5" fill="#1f5c3a" opacity="0.35" />
        <rect x="2" y="20" width="30" height="1.5" rx="0.5" fill="#888" opacity="0.45" />
        <rect x="2" y="23" width="26" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="2" y="26" width="20" height="1.5" rx="0.5" fill="#888" opacity="0.35" />
        <rect x="2" y="31" width="36" height="1.5" rx="0.5" fill="#1f5c3a" opacity="0.35" />
        <rect x="2" y="35" width="28" height="1.5" rx="0.5" fill="#888" opacity="0.45" />
        <rect x="2" y="38" width="22" height="1.5" rx="0.5" fill="#888" opacity="0.4" />
        <rect x="2" y="44" width="36" height="1.5" rx="0.5" fill="#1f5c3a" opacity="0.35" />
        <rect x="2" y="48" width="18" height="1.5" rx="0.5" fill="#888" opacity="0.45" />
      </svg>
    ),
  },
];

const CREATOR_EMAIL = "rogervineeth@gmail.com";

const GEN_STAGES = [
  { label: "Reading your job description...", icon: "📖", pct: 8, ms: 3000 },
  { label: "Extracting key skills & keywords...", icon: "🔍", pct: 25, ms: 9000 },
  { label: "Matching your experience to JD...", icon: "🤝", pct: 45, ms: 13000 },
  { label: "Rewriting bullets with action verbs...", icon: "✍️", pct: 65, ms: 14000 },
  { label: "Calculating ATS match score...", icon: "📊", pct: 82, ms: 10000 },
  { label: "Final polish & formatting...", icon: "✨", pct: 95, ms: 6000 },
];

const WAIT_TIPS = [
  "ATS systems scan for exact keyword matches — the AI weaves yours in naturally.",
  "Tip: Action verbs like 'Led', 'Built', 'Scaled' get 23% more recruiter attention.",
  "Indian hiring managers prefer concise 1-page resumes. Yours will fit perfectly.",
  "87% of Indian hiring managers prefer resumes that mirror the JD language.",
  "Your resume will be optimised for LinkedIn Jobs, Naukri, and company ATSes.",
];

function pushUrlStep(step: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("step", step);
  window.history.pushState({}, "", url.pathname + url.search);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function CreatePage() {
  const router = useRouter();
  const jdRef = useRef<HTMLTextAreaElement>(null);

  const [flowStep, setFlowStep] = useState<1 | 2 | 3 | 4>(() => {
    if (typeof window === "undefined") return 1;
    const step = new URLSearchParams(window.location.search).get("step");
    if (step === "template") return 2;
    if (step === "review") return 3;
    if (step === "resume") return 4;
    return 1;
  });

  const [profile, setProfile] = useState<Profile | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [planCheck, setPlanCheck] = useState<PlanCheck | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [jdText, setJdText] = useState<string>(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem("ndrs_jd") ?? "")
  );
  const [jdAnalysis, setJdAnalysis] = useState<JdAnalysis>({
    detectedRole: null,
    keywords: [],
    quality: "weak",
  });

  const [showMissingPopup, setShowMissingPopup] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genStageIdx, setGenStageIdx] = useState(0);
  const [genProgress, setGenProgress] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [showRevealDone, setShowRevealDone] = useState(false);

  const [generatedResume, setGeneratedResume] = useState<GeneratedResume | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("classic");

  useEffect(() => {
    if (!showRevealDone) return;
    const t = setTimeout(() => setShowRevealDone(false), 3500);
    return () => clearTimeout(t);
  }, [showRevealDone]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserEmail(user.email ?? null);
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

  useEffect(() => {
    localStorage.setItem("ndrs_jd", jdText);
  }, [jdText]);

  useEffect(() => {
    const t = setTimeout(() => setJdAnalysis(analyzeJd(jdText)), 400);
    return () => clearTimeout(t);
  }, [jdText]);

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setTipIdx((i) => (i + 1) % WAIT_TIPS.length), 6000);
    return () => clearInterval(t);
  }, [generating]);

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
    if (userEmail !== CREATOR_EMAIL && planCheck && !planCheck.allowed) {
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
    pushUrlStep("resume");
    try {
      const res = await fetch("/api/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: jdText,
          template: selectedTemplate,
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
        const msg =
          data.code === "AI_PARSE_ERROR" ||
          (rawMsg && rawMsg.toLowerCase().includes("parse"))
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

      setGeneratedResume({
        ats_score: resumeJson.ats_score,
        tailored_role: resumeJson.tailored_role,
        matched_keywords: resumeJson.matched_keywords ?? [],
        missing_keywords: resumeJson.missing_keywords ?? [],
        summary: resumeJson.summary ?? "",
        profile_improvement_tips: resumeJson.profile_improvement_tips ?? [],
        growth_note: resumeJson.growth_note ?? null,
        section_order: resumeJson.section_order ?? [],
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

  async function handleClickGenerate() {
    const comp = checkCompleteness(profile);
    if (!comp.complete) {
      setShowMissingPopup(true);
      return;
    }
    if (userEmail !== CREATOR_EMAIL && planCheck && !planCheck.allowed) {
      toast.error(
        planCheck.reason === "NO_PLAN"
          ? "You need a paid plan to generate a resume."
          : "You've used all credits in your current plan.",
        { action: { label: "View plans", onClick: () => router.push("/pricing") }, duration: 5000 }
      );
      return;
    }
    setFlowStep(4);
    handleGenerate();
  }

  const completeness = checkCompleteness(profile);
  const isCreator = userEmail === CREATOR_EMAIL;
  const jdReady = jdText.trim().length >= 200;
  const canGenerate =
    jdReady &&
    completeness.complete &&
    (isCreator || !planCheck || planCheck.allowed) &&
    !generating;

  const revealStage = Math.min(genStageIdx + 1, 4) as 1 | 2 | 3 | 4;
  const currentGenStage = GEN_STAGES[genStageIdx] ?? GEN_STAGES[GEN_STAGES.length - 1];

  return (
    <div className={`flex flex-col bg-[#f7f3ea] ${flowStep < 4 ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      

      {/* 3-step progress bar */}
      <div className="hidden">
        <div className="max-w-5xl mx-auto px-6 h-12 flex items-center justify-center gap-3">
          {([
            { n: 1, label: "Job Description", done: flowStep > 1 },
            { n: 2, label: "Choose Template", done: flowStep > 2 },
            { n: 3, label: "Review", done: flowStep > 3 },
            { n: 3, label: "Your Resume", done: !!generatedResume },
          ] as { n: 1 | 2 | 3; label: string; done: boolean }[]).map((s, i) => (
            <div key={s.n} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                flowStep === s.n
                  ? "bg-[#1f5c3a] text-white"
                  : s.done
                  ? "bg-[#1f5c3a]/10 text-[#1f5c3a]"
                  : "bg-white/60 text-[#999]"
              }`}>
                <span className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-[0.65rem] ${
                  flowStep === s.n
                    ? "bg-white/20 text-white"
                    : s.done
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
      </div>

      {/* STEP 1 — Job Description */}
      {flowStep === 1 && (
        <div className="flex-1 flex overflow-hidden min-h-0 max-w-7xl mx-auto w-full">
          <div className="flex-1 flex flex-col overflow-y-auto min-h-0 p-6 lg:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-serif italic text-2xl text-[#1a1a1a]">Paste the job description</h2>
                {jdAnalysis.detectedRole && (
                  <span className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full font-medium">
                    📌 {jdAnalysis.detectedRole}
                  </span>
                )}
              </div>
              <p className="text-sm text-[#6b6b6b] mb-3">
                Copy from LinkedIn Jobs, Naukri, or any company careers page.
              </p>
              <Textarea
                ref={jdRef as React.Ref<HTMLTextAreaElement>}
                placeholder="Paste the complete job description here, including responsibilities, requirements, and preferred skills."
                className="min-h-[200px] text-sm leading-relaxed resize-none bg-white"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className={`text-xs ${jdReady ? "text-[#1f5c3a] font-medium" : "text-[#999]"}`}>
                  {jdText.length < 200
                    ? `${jdText.length}/200 characters minimum`
                    : `${jdText.length} characters ✓`}
                </span>
                {jdAnalysis.quality === "good" && (
                  <span className="text-xs text-[#1f5c3a]">Detailed JD ✓</span>
                )}
              </div>
              {jdAnalysis.keywords.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-[#6b6b6b]">Detected skills:</span>
                  {jdAnalysis.keywords.slice(0, 8).map((kw) => (
                    <span key={kw} className="text-xs bg-white border border-[#1f5c3a]/25 text-[#1f5c3a] px-2 py-0.5 rounded-full">
                      {kw}
                    </span>
                  ))}
                  {jdAnalysis.keywords.length > 8 && (
                    <span className="text-xs text-[#999]">+{jdAnalysis.keywords.length - 8} more</span>
                  )}
                </div>
              )}
            </div>

            {loaded && (
              <div className={`mb-6 rounded-xl p-4 border lg:hidden ${
                completeness.complete ? "bg-[#1f5c3a]/5 border-[#1f5c3a]/20" : "bg-amber-50 border-amber-200"
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {completeness.complete
                      ? <CheckCircle2 className="w-4 h-4 text-[#1f5c3a] shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                    <div>
                      <p className="text-sm font-semibold text-[#1a1a1a]">
                        {completeness.complete ? `Profile ready — ${profile?.full_name}` : "Profile incomplete"}
                      </p>
                      {!completeness.complete && (
                        <p className="text-xs text-amber-700 mt-0.5">Missing: {completeness.missing}</p>
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

            {/* Mobile-only next button — desktop uses right panel CTA */}
            <Button
              size="lg"
              onClick={() => { pushUrlStep("template"); setFlowStep(2); }}
              disabled={!jdReady}
              className="lg:hidden w-full text-base py-6 rounded-xl font-semibold mt-auto"
            >
              Next — Choose template →
            </Button>
            {!jdReady && (
              <p className="lg:hidden text-xs text-center text-[#999] mt-2">Paste a job description above to continue</p>
            )}
          </div>

          {/* Desktop right panel — profile card */}
          <div className="hidden lg:flex flex-col w-[400px] border-l border-[#e8e0d0] bg-white/40 overflow-y-auto p-7">
            <p className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide mb-4">Your Profile</p>
            {!loaded ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#9b9080]">Loading...</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className={`rounded-xl p-4 border ${
                  completeness.complete ? "bg-[#1f5c3a]/5 border-[#1f5c3a]/20" : "bg-amber-50 border-amber-200"
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {completeness.complete
                        ? <CheckCircle2 className="w-4 h-4 text-[#1f5c3a] shrink-0 mt-0.5" />
                        : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
                      <div>
                        <p className="text-sm font-semibold text-[#1a1a1a]">
                          {completeness.complete ? profile?.full_name : "Profile incomplete"}
                        </p>
                        {completeness.complete ? (
                          <>
                            <p className="text-xs text-[#6b6b6b] mt-0.5">{profile?.email}</p>
                            {(profile?.target_roles?.length ?? 0) > 0 && (
                              <p className="text-xs text-[#6b6b6b] mt-0.5">
                                Targeting: {profile!.target_roles!.slice(0, 2).join(", ")}
                              </p>
                            )}
                            {planCheck?.allowed && (
                              <p className="text-xs text-[#1f5c3a] font-medium mt-1">
                                {planCheck.remaining} credit{planCheck.remaining !== 1 ? "s" : ""} remaining
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-amber-700 mt-0.5">Missing: {completeness.missing}</p>
                        )}
                      </div>
                    </div>
                    <Link href="/profile">
                      <Button variant="outline" size="sm" className="text-xs h-7 shrink-0">
                        {completeness.complete ? "Edit" : "Fix →"}
                      </Button>
                    </Link>
                  </div>
                </div>

                {(profile?.profile_data?.experience?.length ?? 0) > 0 && profile?.profile_data?.experience?.some((e) => e?.role || e?.company) && (
                  <div className="rounded-xl bg-white border border-stone-200 p-4">
                    <p className="text-xs font-semibold text-[#1a1a1a] mb-2">Experience</p>
                    {(profile?.profile_data?.experience ?? []).slice(0, 2).map((exp, i) => (
                      <div key={i} className="mb-2 last:mb-0">
                        <p className="text-xs font-medium text-[#1a1a1a]">{exp.role}</p>
                        <p className="text-xs text-[#6b6b6b]">{exp.company} · {exp.duration}</p>
                      </div>
                    ))}
                  </div>
                )}

                {(profile?.profile_data?.skills?.length ?? 0) > 0 && (
                  <div className="rounded-xl bg-white border border-stone-200 p-4">
                    <p className="text-xs font-semibold text-[#1a1a1a] mb-2">Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(profile?.profile_data?.skills ?? []).slice(0, 8).map((s) => (
                        <span key={s} className="text-xs bg-[#f7f3ea] text-[#6b6b6b] border border-stone-200 px-2 py-0.5 rounded-full">
                          {s}
                        </span>
                      ))}
                      {(profile?.profile_data?.skills?.length ?? 0) > 8 && (
                        <span className="text-xs text-[#999]">+{(profile?.profile_data?.skills?.length ?? 0) - 8}</span>
                      )}
                    </div>
                  </div>
                )}

                {completeness.complete && (
                  <div className="flex items-center gap-2 text-xs text-[#6b6b6b]">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-[#1f5c3a]" />
                    Profile looks good — paste a JD above to continue.
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto pt-6">
              <Button
                size="lg"
                onClick={() => { pushUrlStep("template"); setFlowStep(2); }}
                disabled={!jdReady}
                className="w-full text-base py-6 rounded-xl font-semibold"
              >
                Next — Choose template →
              </Button>
              {!jdReady && (
                <p className="text-xs text-center text-[#999] mt-2">Paste a job description to continue</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 — Choose Template */}
      {flowStep === 2 && (
        <div className="flex-1 flex overflow-hidden min-h-0 max-w-7xl mx-auto w-full">
          {/* Left: template picker */}
          <div className="flex-1 flex flex-col overflow-y-auto min-h-0 p-6 lg:p-8">
            <button
              type="button"
              onClick={() => { pushUrlStep("jd"); setFlowStep(1); }}
              className="flex items-center gap-1.5 text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors mb-6 self-start"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <h2 className="font-serif italic text-2xl text-[#1a1a1a] mb-1">Choose your template</h2>
            <p className="text-sm text-[#6b6b6b] mb-6">
              All templates are ATS-optimised and single-column.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => { setSelectedTemplate(tpl.id); if (typeof window !== "undefined") localStorage.setItem("ndrs_template", tpl.id); }}
                  className={`rounded-xl border-2 overflow-hidden text-left transition-all focus:outline-none ${
                    selectedTemplate === tpl.id
                      ? "border-[#1f5c3a] shadow-md"
                      : "border-stone-200 bg-white hover:border-[#1f5c3a]/40"
                  }`}
                >
                  {/* Preview image */}
                  <div className="relative w-full bg-stone-50 border-b border-stone-100" style={{height: 200}}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/template-previews/${tpl.id}.png`}
                      alt={`${tpl.label} template preview`}
                      className="w-full h-full object-cover object-top"
                    />
                    {selectedTemplate === tpl.id && (
                      <div className="absolute top-2 right-2 bg-[#1f5c3a] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        Selected
                      </div>
                    )}
                  </div>
                  {/* Label row */}
                  <div className={`px-4 py-3 ${selectedTemplate === tpl.id ? "bg-[#1f5c3a]/5" : "bg-white"}`}>
                    <p className={`text-sm font-semibold ${selectedTemplate === tpl.id ? "text-[#1f5c3a]" : "text-[#1a1a1a]"}`}>
                      {tpl.label}
                    </p>
                    <p className="text-xs text-[#6b6b6b] mt-0.5">{tpl.description}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Mobile-only generate button */}
            <div className="lg:hidden mt-auto pt-6">
              {planCheck && !planCheck.allowed && !isCreator && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 flex items-center justify-between gap-2">
                  <span>{planCheck.reason === "NO_PLAN" ? "You need a paid plan." : `All ${planCheck.allotted} credits used.`}</span>
                  <Link href="/pricing" className="font-semibold underline whitespace-nowrap">{planCheck.reason === "NO_PLAN" ? "View plans →" : "Buy more →"}</Link>
                </div>
              )}
              <Button size="lg" onClick={() => { pushUrlStep("review"); setFlowStep(3); }} disabled={!canGenerate} className="w-full text-base py-6 rounded-xl font-semibold">
                Next — Review →
              </Button>
            </div>
          </div>

          {/* Right: compact profile summary + Generate CTA */}
          <div className="hidden lg:flex flex-col w-[400px] border-l border-[#e8e0d0] bg-white/40 overflow-y-auto p-7">
            <p className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide mb-4">Generating for</p>

            <div className="rounded-xl bg-white border border-stone-200 p-4 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-[#1f5c3a] shrink-0" />
                <p className="text-sm font-semibold text-[#1a1a1a]">{profile?.full_name}</p>
              </div>
              <p className="text-xs text-[#6b6b6b]">{profile?.email}</p>
              {(profile?.target_roles?.length ?? 0) > 0 && (
                <p className="text-xs text-[#6b6b6b] mt-0.5">
                  Targeting: {profile!.target_roles!.slice(0, 2).join(", ")}
                </p>
              )}
              {planCheck?.allowed && (
                <p className="text-xs text-[#1f5c3a] font-medium mt-1">
                  {planCheck.remaining} credit{planCheck.remaining !== 1 ? "s" : ""} remaining
                </p>
              )}
            </div>

            <div className="rounded-xl bg-[#f7f3ea] border border-stone-200 p-4 mb-3">
              <p className="text-xs font-semibold text-[#1a1a1a] mb-1">Job Description</p>
              <p className="text-xs text-[#6b6b6b]">{jdText.length} characters</p>
              {jdAnalysis.detectedRole && (
                <p className="text-xs text-[#1f5c3a] mt-0.5">📌 {jdAnalysis.detectedRole}</p>
              )}
              {jdAnalysis.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {jdAnalysis.keywords.slice(0, 5).map((kw) => (
                    <span key={kw} className="text-xs bg-white border border-[#1f5c3a]/25 text-[#1f5c3a] px-1.5 py-0.5 rounded-full">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />

            {planCheck && !planCheck.allowed && !isCreator && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
                <span>{planCheck.reason === "NO_PLAN" ? "You need a paid plan to generate." : `All ${planCheck.allotted} credits used.`}</span>
                {" "}
                <Link href="/pricing" className="font-semibold underline">
                  {planCheck.reason === "NO_PLAN" ? "View plans →" : "Buy more →"}
                </Link>
              </div>
            )}

            <Button
              size="lg"
              onClick={() => { pushUrlStep("review"); setFlowStep(3); }}
              disabled={!canGenerate}
              className="w-full text-base py-6 rounded-xl font-semibold"
            >
              Next — Review →
            </Button>

            {!completeness.complete && (
              <p className="text-xs text-center text-amber-700 mt-2">
                Profile incomplete.{" "}
                <Link href="/profile" className="underline">Fix it first →</Link>
              </p>
            )}
          </div>
        </div>
      )}

      {/* STEP 3 — Review */}
      {flowStep === 3 && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-6">
              <h2 className="text-xl font-semibold text-[#1a1a1a] mb-1">Review your resume</h2>
              <p className="text-xs text-[#6b6b6b]">Check everything looks right before the AI generates your resume. Click any section to edit.</p>
            </div>

            {/* Basics */}
            {profile && (
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide">Basics</p>
                  <Link href="/profile?step=basics" className="text-xs text-[#1f5c3a] underline underline-offset-2">Edit</Link>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  {profile.full_name && <span className="font-medium text-[#1a1a1a]">{profile.full_name}</span>}
                  {profile.email && <span className="text-[#6b6b6b]">{profile.email}</span>}
                  {profile.phone && profile.phone.trim() !== "+91" && profile.phone.trim() !== "+91 " && !profile.phone.startsWith("e.g.") && (
                    <span className="text-[#6b6b6b]">{profile.phone}</span>
                  )}
                  {profile.current_city && !profile.current_city.startsWith("e.g.") && (
                    <span className="text-[#6b6b6b]">{profile.current_city}</span>
                  )}
                  {(profile.target_roles?.length ?? 0) > 0 && (
                    <span className="text-[#6b6b6b] mt-0.5">Targeting: {profile.target_roles!.join(", ")}</span>
                  )}
                </div>
              </div>
            )}

            {/* Experience */}
            {(() => {
              const pd = (profile?.profile_data ?? {}) as Record<string, unknown>;
              const exp = Array.isArray(pd.experience) ? pd.experience as { company?: string; role?: string; duration?: string }[] : [];
              const expFilled = exp.filter((e) => e.company?.trim());
              return expFilled.length > 0 ? (
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide">Experience</p>
                    <Link href="/profile?step=experience" className="text-xs text-[#1f5c3a] underline underline-offset-2">Edit</Link>
                  </div>
                  <div className="flex flex-col gap-2">
                    {expFilled.map((e, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-medium text-[#1a1a1a]">{e.role}</span>
                        <span className="text-[#6b6b6b]"> at {e.company}</span>
                        {e.duration && <span className="text-[#6b6b6b]"> · {e.duration}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-amber-800">No experience added <span className="text-amber-600">(optional)</span></p>
                    <Link href="/profile?step=experience" className="text-xs text-amber-700 underline underline-offset-2">Add</Link>
                  </div>
                </div>
              );
            })()}

            {/* Education */}
            {(() => {
              const pd = (profile?.profile_data ?? {}) as Record<string, unknown>;
              const edu = Array.isArray(pd.education) ? pd.education as { institution?: string; degree?: string; year?: string }[] : [];
              const eduFilled = edu.filter((e) => e.institution?.trim() && e.institution !== "__blank__");
              return eduFilled.length > 0 ? (
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide">Education</p>
                    <Link href="/profile?step=education" className="text-xs text-[#1f5c3a] underline underline-offset-2">Edit</Link>
                  </div>
                  <div className="flex flex-col gap-2">
                    {eduFilled.map((e, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-medium text-[#1a1a1a]">{e.institution}</span>
                        {e.degree && <span className="text-[#6b6b6b]"> · {e.degree}</span>}
                        {e.year && <span className="text-[#6b6b6b]"> · {e.year}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Job Description summary */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide">Job Description</p>
                <button onClick={() => { pushUrlStep("jd"); setFlowStep(1); }} className="text-xs text-[#1f5c3a] underline underline-offset-2">Edit</button>
              </div>
              <p className="text-xs text-[#6b6b6b]">{jdText.length} characters</p>
              {jdAnalysis.detectedRole && <p className="text-sm font-medium text-[#1a1a1a] mt-1">📌 {jdAnalysis.detectedRole}</p>}
              {jdAnalysis.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {jdAnalysis.keywords.slice(0, 8).map((kw) => (
                    <span key={kw} className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full border border-[#1f5c3a]/20">{kw}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Template */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-8">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide">Template</p>
                <button onClick={() => { pushUrlStep("template"); setFlowStep(2); }} className="text-xs text-[#1f5c3a] underline underline-offset-2">Change</button>
              </div>
              <p className="text-sm font-medium text-[#1a1a1a] capitalize">{selectedTemplate}</p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={() => { pushUrlStep("template"); setFlowStep(2); }} className="flex-1 gap-1.5">
                <ChevronLeft className="w-4 h-4" />Back to Template
              </Button>
              <Button
                size="lg"
                onClick={handleClickGenerate}
                disabled={!canGenerate}
                className="flex-1 text-base py-6 rounded-xl font-semibold"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate my resume →
              </Button>
            </div>
            {!completeness.complete && (
              <p className="text-xs text-center text-amber-700 mt-3">
                Profile incomplete.{" "}
                <Link href="/profile" className="underline">Fix it first →</Link>
              </p>
            )}
          </div>
        </div>
      )}

      {/* STEP 4 — Your Resume */}
      {flowStep === 4 && (
        <div className="flex-1 flex flex-col items-center justify-center py-10 px-6">
          <div className="w-full max-w-lg">
            {generating ? (
              <>
                <div className="mb-6">
                  <div className="flex items-center justify-between text-xs text-[#6b6b6b] mb-2">
                    <span>{currentGenStage.label}</span>
                    <span>{genProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#e8e0d0] overflow-hidden">
                    <div
                      className="h-full bg-[#1f5c3a] transition-all duration-300"
                      style={{ width: `${genProgress}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs italic text-center text-[#6b6b6b]">{WAIT_TIPS[tipIdx]}</p>
                </div>
                <div className="flex items-center justify-center">
                  <MagicReveal stage={revealStage} atsScore={null} />
                </div>
              </>
            ) : showRevealDone ? (
              <MagicReveal stage="done" atsScore={generatedResume?.ats_score ?? null} />
            ) : generatedResume ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#1f5c3a] flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-[#1a1a1a] text-sm">Resume ready!</p>
                    <p className="text-xs text-[#6b6b6b]">Tailored for {generatedResume.tailored_role}</p>
                  </div>
                </div>

                <div className="bg-[#1f5c3a] text-white rounded-2xl p-5">
                  <p className="text-xs opacity-70 mb-0.5">ATS Match Score</p>
                  <div className="flex items-end gap-1.5">
                    <span className="font-serif italic text-5xl">{generatedResume.ats_score}</span>
                    <span className="text-xl opacity-50 pb-1">/100</span>
                  </div>
                  <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white rounded-full transition-all duration-1000"
                      style={{ width: `${generatedResume.ats_score}%` }}
                    />
                  </div>
                </div>

                {generatedResume.matched_keywords.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#1a1a1a] mb-2">
                      ✓ Keywords matched ({generatedResume.matched_keywords.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {generatedResume.matched_keywords.slice(0, 8).map((kw) => (
                        <span key={kw} className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {generatedResume.missing_keywords.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#1a1a1a] mb-2">
                      ⚠ Consider adding ({generatedResume.missing_keywords.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {generatedResume.missing_keywords.map((kw) => (
                        <span key={kw} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-[#f7f3ea] rounded-xl p-4">
                  <p className="text-xs font-semibold text-[#1a1a1a] mb-1.5">📝 AI-written summary</p>
                  <p className="text-xs text-[#6b6b6b] leading-relaxed line-clamp-5">{generatedResume.summary}</p>
                </div>
                {generatedResume.growth_note && generatedResume.growth_note !== "null" && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-amber-800 mb-1">⚠ Honest fit assessment</p>
                    <p className="text-xs text-amber-700 leading-relaxed">{generatedResume.growth_note}</p>
                  </div>
                )}
                {(generatedResume.profile_improvement_tips ?? []).length > 0 && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <p className="text-xs font-semibold text-blue-800 mb-2">💡 Improve your profile to score higher</p>
                    <ul className="space-y-1.5">
                      {(generatedResume.profile_improvement_tips ?? []).map((tip, i) => (
                        <li key={i} className="text-xs text-blue-700 leading-relaxed flex gap-1.5">
                          <span className="shrink-0 mt-0.5">→</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Button size="lg" className="w-full" onClick={() => router.push(`/preview/${savedResumeId}`)}>
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
                      pushUrlStep("jd");
                      setFlowStep(1);
                    }}
                  >
                    Start over
                  </Button>
                </div>
              </div>
            ) : genError ? (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                </div>
                <p className="text-sm font-semibold text-[#1a1a1a] mb-1">Something went wrong</p>
                <p className="text-sm text-[#6b6b6b] mb-5">{genError}</p>
                <Button onClick={() => { setGenError(null); pushUrlStep("review"); setFlowStep(3); }}>
                  ← Try again
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showMissingPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-[#1a1a1a] text-lg mb-1">Profile needs attention</h3>
            <p className="text-sm text-[#6b6b6b] mb-5">
              The AI needs your{" "}
              <span className="font-medium text-[#1a1a1a]">{completeness.missing}</span>{" "}
              to create a tailored resume.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                onClick={() => { setShowMissingPopup(false); router.push("/profile"); }}
              >
                Complete my profile →
              </Button>
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowMissingPopup(false)}>
                Not now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
