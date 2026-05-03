"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  X,
  GripVertical,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Upload,
  SkipForward,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { INDIAN_JOB_ROLES } from "@/lib/seed/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ProfileData } from "@/lib/profile-data";

// ── Types ─────────────────────────────────────────────────────────────────
type ExpEntry = {
  id: string;
  company: string;
  role: string;
  duration: string;
  location: string;
  bullets: string[];
};
type EduEntry = {
  id: string;
  institution: string;
  degree: string;
  year: string;
  location: string;
  cgpa: string;
};
type ProjEntry = {
  id: string;
  name: string;
  description: string;
  tech: string[];
};
type BasicInfo = {
  full_name: string;
  email: string;
  phone: string;
  current_city: string;
  graduation_year: string;
};
type Resume = { id: string; tailored_role: string; created_at: string };

// ── Helpers ───────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function emptyExp(): ExpEntry {
  return { id: uid(), company: "", role: "", duration: "", location: "", bullets: [""] };
}
function emptyEdu(): EduEntry {
  return { id: uid(), institution: "", degree: "", year: "", location: "", cgpa: "" };
}
function emptyProj(): ProjEntry {
  return { id: uid(), name: "", description: "", tech: [] };
}

// ── Save indicator ────────────────────────────────────────────────────────
type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── Stepper config ────────────────────────────────────────────────────────
const STEPS = [
  { label: "Basics",     required: true,  description: "Your contact details and a quick summary." },
  { label: "Experience", required: false, description: "Your work history. Optional — skip if you're a fresher." },
  { label: "Education",  required: false, description: "Your academic background." },
  { label: "Projects",   required: false, description: "Projects you've built or contributed to." },
  { label: "Roles",      required: true,  description: "The roles you're targeting — used to tailor every resume." },
] as const;



function StepNav({
  current,
  onBack,
  onNext,
  nextDisabled,
  onSkip,
  canSkip,
}: {
  current: number;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  onSkip?: () => void;
  canSkip?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mt-8 pt-6 border-t border-stone-200">
      <Button variant="outline" onClick={onBack} disabled={current === 0} className="gap-1.5">
        <ChevronLeft className="w-4 h-4" />Back
      </Button>
      <div className="flex items-center gap-3">
        {canSkip && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="flex items-center gap-1.5 text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors underline underline-offset-4"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip this section
          </button>
        )}
        <Button onClick={onNext} disabled={nextDisabled} className="gap-1.5">
          Next<ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-[#6b6b6b]">{label}</Label>
      {children}
    </div>
  );
}

function ProfilePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPreview = searchParams.get("from") === "preview";
  const fromResumeId = searchParams.get("resumeId") ?? "";

  const STEP_KEYS = useMemo(() => ["basics", "experience", "education", "projects", "roles"], []);

  const stepParam = searchParams.get("step");
  const currentStep = (() => {
    const i = STEP_KEYS.indexOf(stepParam || "");
    return i >= 0 ? i : 0;
  })();

  const formTopRef = useRef<HTMLDivElement>(null);

  const setCurrentStep = useCallback(
    (next: number | ((prev: number) => number)) => {
      const target = typeof next === "function" ? next(currentStep) : next;
      const clamped = Math.max(0, Math.min(STEP_KEYS.length - 1, target));
      const url = new URL(window.location.href);
      url.searchParams.set("step", STEP_KEYS[clamped] || "basics");
      window.history.pushState({}, "", url.pathname + url.search);
      window.dispatchEvent(new PopStateEvent("popstate"));
      // Scroll to top of form card after step change
      setTimeout(() => {
        formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    },
    [currentStep, STEP_KEYS]
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [basics, setBasics] = useState<BasicInfo>({ full_name: "", email: "", phone: "", current_city: "", graduation_year: "" });
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [experience, setExperience] = useState<ExpEntry[]>([emptyExp()]);
  const [expSkipped, setExpSkipped] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [education, setEducation] = useState<EduEntry[]>([emptyEdu()]);
  const [eduSkipped, setEduSkipped] = useState(false);
  const [projects, setProjects] = useState<ProjEntry[]>([]);
  const [projSkipped, setProjSkipped] = useState(false);
  const [certifications, setCertifications] = useState<string[]>([]);
  const [achievements, setAchievements] = useState<string[]>([]);
  const [certInput, setCertInput] = useState("");
  const [achievementInput, setAchievementInput] = useState("");
  const [isFresher, setIsFresher] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [skillInput, setSkillInput] = useState("");
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [issueResumeId, setIssueResumeId] = useState("");
  const [issueDesc, setIssueDesc] = useState("");
  const [submittingIssue, setSubmittingIssue] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      const [profileRes, resumesRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).single(),
        supabase.from("resumes").select("id,tailored_role,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      ]);
      if (profileRes.data) {
        const p = profileRes.data;
        const cleanPhone = (p.phone ?? "").trim();
        const cleanGradYear = p.graduation_year ? String(p.graduation_year) : "";
        setBasics({
          full_name: p.full_name ?? "",
          email: p.email ?? "",
          phone: (cleanPhone === "+91" || cleanPhone === "+91 ") ? "" : cleanPhone,
          current_city: p.current_city ?? "",
          graduation_year: cleanGradYear,
        });
        setTargetRoles(p.target_roles ?? []);
        const pd: ProfileData = p.profile_data ?? {};
        if (pd.summary && !pd.summary.startsWith("e.g.")) setSummary(pd.summary);
        if (pd.experience?.length) setExperience(pd.experience.map((e) => ({ ...e, id: uid() })));
        if (pd.skills?.length) setSkills(pd.skills);
        if (pd.education?.length) setEducation(pd.education.map((e) => ({ ...e, id: uid(), cgpa: e.cgpa ?? "" })));
        if (pd.projects?.length) setProjects(pd.projects.map((e) => ({ ...e, id: uid() })));
        if (pd.certifications?.length) setCertifications(pd.certifications);
        if (pd.achievements?.length) setAchievements(pd.achievements);
        if (pd.isFresher !== undefined) setIsFresher(!!pd.isFresher);
        if (pd.expSkipped !== undefined) setExpSkipped(!!pd.expSkipped);
        if (pd.eduSkipped !== undefined) setEduSkipped(!!pd.eduSkipped);
        if (pd.projSkipped !== undefined) setProjSkipped(!!pd.projSkipped);
      }
      if (resumesRes.data) setResumes(resumesRes.data as Resume[]);
      setLoaded(true);
    });
  }, [router]);

  const scheduleSave = useCallback(() => {
    if (!userId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      const supabase = createClient();
      const profileData: ProfileData = {
        isFresher,
        expSkipped,
        eduSkipped,
        projSkipped,
        summary,
        experience: experience.map((e) => ({ company: e.company, role: e.role, duration: e.duration, location: e.location, bullets: e.bullets })),
        skills,
        education: education.map((e) => ({ institution: e.institution, degree: e.degree, year: e.year, location: e.location, cgpa: e.cgpa })),
        projects: projects.map((p) => ({ name: p.name, description: p.description, tech: p.tech })),
        certifications,
        achievements,
      };
      const { error } = await supabase.from("profiles").update({
        full_name: basics.full_name, email: basics.email, phone: basics.phone || null,
        current_city: basics.current_city || null,
        graduation_year: basics.graduation_year ? parseInt(basics.graduation_year) : null,
        target_roles: targetRoles, profile_data: profileData,
      }).eq("user_id", userId);
      setSaveStatus(error ? "error" : "saved");
      if (error) toast.error("Auto-save failed: " + error.message);
    }, 1000);
  }, [userId, basics, targetRoles, summary, experience, skills, education, projects, certifications, achievements, isFresher, expSkipped, eduSkipped, projSkipped]);

  useEffect(() => {
    if (!loaded) return;
    scheduleSave();
  }, [loaded, basics, targetRoles, summary, experience, skills, education, projects, certifications, achievements, isFresher, expSkipped, eduSkipped, projSkipped, scheduleSave]);

  const sec1Done = !!(basics.full_name.trim() && basics.email.trim());
  const sec2Done = targetRoles.length > 0;
  // Experience: done if skipped, fresher-flagged, or has at least one entry
  const sec3Done = expSkipped || isFresher || experience.some((e) => e.company.trim());
  // Education: done if skipped or has at least one entry
  const sec4Done = eduSkipped || education.some((e) => e.institution.trim());
  // Projects: always optional — done if skipped or has entries
  const sec5Done = projSkipped || projects.some((p) => p.name.trim());
  const completed = [sec1Done, sec3Done, sec4Done, sec5Done, sec2Done];

  const nextDisabled =
    (currentStep === 0 && !sec1Done) ||
    (currentStep === 4 && !sec2Done);

  function handleNext() {
    if (currentStep === 0 && !sec1Done) {
      toast.info("Fill in your full name and email — both are required to continue.");
      return;
    }
    if (currentStep === 4 && !sec2Done) {
      toast.info("Pick at least one target role so the AI knows what to tailor for.");
      return;
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      router.push("/create");
    }
  }

  function handleBack() { if (currentStep > 0) setCurrentStep((s) => s - 1); }

  function handleSkipExperience() {
    setExpSkipped(true);
    setCurrentStep((s) => s + 1);
  }
  function handleSkipEducation() {
    setEduSkipped(true);
    setCurrentStep((s) => s + 1);
  }
  function handleSkipProjects() {
    setProjSkipped(true);
    setCurrentStep((s) => s + 1);
  }

  function toggleRole(role: string) {
    setTargetRoles((prev) => {
      if (prev.includes(role)) return prev.filter((r) => r !== role);
      if (prev.length >= 3) { toast.info("Pick up to 3 roles."); return prev; }
      return [...prev, role];
    });
  }

  function updateExp(id: string, field: keyof Omit<ExpEntry, "id" | "bullets">, val: string) { setExperience((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: val } : e))); }
  function addExp() { setExperience((prev) => [...prev, emptyExp()]); }
  function removeExp(id: string) { setExperience((prev) => prev.filter((e) => e.id !== id)); }
  function updateBullet(expId: string, bi: number, val: string) { setExperience((prev) => prev.map((e) => { if (e.id !== expId) return e; const bullets = [...e.bullets]; bullets[bi] = val; return { ...e, bullets }; })); }
  function addBullet(expId: string) { setExperience((prev) => prev.map((e) => (e.id === expId ? { ...e, bullets: [...e.bullets, ""] } : e))); }
  function removeBullet(expId: string, bi: number) { setExperience((prev) => prev.map((e) => { if (e.id !== expId) return e; const bullets = e.bullets.filter((_, i) => i !== bi); return { ...e, bullets: bullets.length ? bullets : [""] }; })); }
  function moveBullet(expId: string, bi: number, dir: -1 | 1) { setExperience((prev) => prev.map((e) => { if (e.id !== expId) return e; const bullets = [...e.bullets]; const ni = bi + dir; if (ni < 0 || ni >= bullets.length) return e; [bullets[bi], bullets[ni]] = [bullets[ni], bullets[bi]]; return { ...e, bullets }; })); }

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingResume(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-resume", { method: "POST", body: form });
      const data = await res.json();
      if (data.error && !data.extracted) { toast.error(data.error || "Couldn't parse the file."); return; }
      const ep = data.extracted ?? {};
      if (ep.name) setBasics((prev: BasicInfo) => ({ ...prev, full_name: ep.name }));
      if (ep.email) setBasics((prev: BasicInfo) => ({ ...prev, email: ep.email }));
      if (ep.phone) setBasics((prev: BasicInfo) => ({ ...prev, phone: ep.phone }));
      if (ep.city) setBasics((prev: BasicInfo) => ({ ...prev, current_city: ep.city }));
      if (ep.graduation_year) setBasics((prev: BasicInfo) => ({ ...prev, graduation_year: String(ep.graduation_year) }));
      if (ep.experience?.length) setExperience(ep.experience.map((e: Omit<ExpEntry, "id">) => ({ ...e, id: uid(), bullets: e.bullets?.length ? e.bullets : [""] })));
      if (ep.education?.length) setEducation(ep.education.map((e: Omit<EduEntry, "id">) => ({ ...e, id: uid(), cgpa: e.cgpa ?? "" })));
      if (ep.skills?.length) setSkills(ep.skills);
      if (ep.projects?.length) setProjects(ep.projects.map((p: Omit<ProjEntry, "id">) => ({ ...p, id: uid() })));
      if (ep.certifications?.length) setCertifications(ep.certifications);
      if (ep.achievements?.length) setAchievements(ep.achievements);
      const extracted: string[] = [];
      if (ep.experience?.length) extracted.push("experience");
      if (ep.education?.length) extracted.push("education");
      if (ep.skills?.length) extracted.push("skills");
      if (ep.projects?.length) extracted.push("projects");
      if (ep.certifications?.length) extracted.push("certifications");
      if (ep.achievements?.length) extracted.push("achievements");
      if (extracted.length) toast.success(`Resume parsed — ${extracted.join(", ")} pre-filled. Review and edit as needed.`);
      else toast.info("Contact details extracted. Fill in experience and education below.");
    } catch { toast.error("Upload failed. Please try again."); }
    finally { setUploadingResume(false); e.target.value = ""; }
  };

  function addSkill(val: string) { const t = val.trim(); if (!t || skills.includes(t)) return; setSkills((prev) => [...prev, t]); setSkillInput(""); }
  function removeSkill(skill: string) { setSkills((prev) => prev.filter((s) => s !== skill)); }

  function updateEdu(id: string, field: keyof Omit<EduEntry, "id">, val: string) { setEducation((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: val } : e))); }
  function addEdu() { setEducation((prev) => [...prev, emptyEdu()]); }
  function removeEdu(id: string) { setEducation((prev) => prev.filter((e) => e.id !== id)); }

  function updateProj(id: string, field: keyof Omit<ProjEntry, "id" | "tech">, val: string) { setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: val } : p))); }
  function updateProjTech(id: string, val: string) { setProjects((prev) => prev.map((p) => p.id === id ? { ...p, tech: val.split(",").map((t) => t.trim()).filter(Boolean) } : p)); }
  function addProj() { setProjects((prev) => [...prev, emptyProj()]); }
  function removeProj(id: string) { setProjects((prev) => prev.filter((p) => p.id !== id)); }

  function addCert(val: string) { const t = val.trim(); if (!t || certifications.includes(t)) return; setCertifications((prev) => [...prev, t]); setCertInput(""); }
  function removeCert(c: string) { setCertifications((prev) => prev.filter((x) => x !== c)); }
  function addAchievement(val: string) { const t = val.trim(); if (!t || achievements.includes(t)) return; setAchievements((prev) => [...prev, t]); setAchievementInput(""); }
  function removeAchievement(a: string) { setAchievements((prev) => prev.filter((x) => x !== a)); }

  async function submitIssue() {
    if (!issueResumeId) { toast.error("Select a resume."); return; }
    if (issueDesc.trim().length < 20) { toast.error("Please describe the issue (min 20 chars)."); return; }
    if (!userId) return;
    setSubmittingIssue(true);
    const supabase = createClient();
    const { error } = await supabase.from("generation_issues").insert({ user_id: userId, resume_id: issueResumeId, description: issueDesc.trim() });
    setSubmittingIssue(false);
    if (error) { toast.error("Couldn't submit issue: " + error.message); return; }
    toast.success("Issue reported — we'll review and may refund your credit.");
    setIssueResumeId(""); setIssueDesc("");
  }

  const saveLabel = saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : saveStatus === "error" ? "Save failed" : "";

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[#f7f3ea]">
        
        <div className="flex items-center justify-center min-h-[60vh]"><p className="text-[#6b6b6b]">Loading profile…</p></div>
      </div>
    );
  }

  function renderStep() {
    switch (currentStep) {
      case 0:
        return (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full name *"><Input value={basics.full_name} onChange={(e) => setBasics((b) => ({ ...b, full_name: e.target.value }))} placeholder="Your full name" /></Field>
              <Field label="Email *"><Input type="email" value={basics.email} onChange={(e) => setBasics((b) => ({ ...b, email: e.target.value }))} placeholder="you@example.com" /></Field>
              <Field label="Phone (optional)"><Input value={basics.phone} onChange={(e) => setBasics((b) => ({ ...b, phone: e.target.value }))} placeholder="+91 98765 43210" /></Field>
              <Field label="Current city (optional)"><Input value={basics.current_city} onChange={(e) => setBasics((b) => ({ ...b, current_city: e.target.value }))} placeholder="e.g. Kochi" /></Field>
              <Field label="Graduation year (optional)"><Input value={basics.graduation_year} onChange={(e) => setBasics((b) => ({ ...b, graduation_year: e.target.value }))} inputMode="numeric" placeholder="e.g. 2022" /></Field>
            </div>
            <div>
              <p className="text-sm font-medium text-[#1a1a1a] mb-1">Professional summary <span className="text-xs text-[#6b6b6b] font-normal">(optional)</span></p>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Distribution sales professional with 8 years of experience across FMCG and pharma." className="min-h-[90px] bg-white resize-none text-sm" />
            </div>
          </div>
        );

      case 1:
        return (
          <div>
            {/* Fresher checkbox */}
            <div className="flex items-center gap-3 mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <input
                type="checkbox"
                id="isFresher"
                checked={isFresher}
                onChange={(e) => { setIsFresher(e.target.checked); if (e.target.checked) setExpSkipped(false); }}
                className="w-4 h-4 accent-[#1f5c3a] cursor-pointer"
              />
              <label htmlFor="isFresher" className="text-sm font-medium text-amber-800 cursor-pointer select-none">
                I&apos;m a fresher / I have no work experience
                <span className="block text-xs font-normal text-amber-600 mt-0.5">Tick this to mark Experience as complete — you can still add internships below.</span>
              </label>
            </div>

            {/* Skipped banner */}
            {expSkipped && !isFresher && (
              <div className="flex items-center justify-between mb-5 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                <p className="text-sm text-[#6b6b6b]">Experience section skipped.</p>
                <button type="button" onClick={() => setExpSkipped(false)} className="text-xs text-[#1f5c3a] underline underline-offset-2 hover:opacity-80">Add experience</button>
              </div>
            )}

            {!expSkipped && (
              <>
                {/* Upload existing resume */}
                <div className="mb-5 p-4 bg-stone-50 border border-stone-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#1a1a1a]">Upload your existing resume</p>
                    <p className="text-xs text-[#6b6b6b] mt-0.5">PDF only · We'll extract and pre-fill all sections automatically.</p>
                  </div>
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors border ${uploadingResume ? "bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed" : "bg-white text-[#1f5c3a] border-[#1f5c3a] hover:bg-[#1f5c3a] hover:text-white"}`}>
                    <Upload className="w-4 h-4" />
                    {uploadingResume ? "Parsing…" : "Upload PDF"}
                    <input type="file" accept="application/pdf" className="hidden" disabled={uploadingResume} onChange={handleResumeUpload} />
                  </label>
                </div>

                <p className="text-xs text-[#6b6b6b] mb-4">
                  {isFresher
                    ? "Optional — add any internships, part-time work, or freelance projects below."
                    : "Add your work history. Start bullets with a strong action verb (Led, Built, Delivered…)."}
                </p>
                <div className="flex flex-col gap-4">
                  {experience.map((exp, ei) => (
                    <div key={exp.id} className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#1a1a1a]">{exp.company || `Role ${ei + 1}`}</p>
                        {experience.length > 1 && <button type="button" onClick={() => removeExp(exp.id)} className="text-[#6b6b6b] hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input value={exp.company} onChange={(e) => updateExp(exp.id, "company", e.target.value)} placeholder="Company name" className="text-sm" />
                        <Input value={exp.role} onChange={(e) => updateExp(exp.id, "role", e.target.value)} placeholder="Your role / title" className="text-sm" />
                        <Input value={exp.duration} onChange={(e) => updateExp(exp.id, "duration", e.target.value)} placeholder="Duration e.g. Jan 2022 – Mar 2024" className="text-sm" />
                        <Input value={exp.location} onChange={(e) => updateExp(exp.id, "location", e.target.value)} placeholder="Location e.g. Bengaluru" className="text-sm" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-[#6b6b6b] font-medium">Key achievements / responsibilities:</p>
                        {exp.bullets.map((bullet, bi) => (
                          <div key={bi} className="flex items-center gap-2">
                            <div className="flex flex-col gap-0.5">
                              <button type="button" onClick={() => moveBullet(exp.id, bi, -1)} disabled={bi === 0} className="text-[#6b6b6b] hover:text-[#1a1a1a] disabled:opacity-30"><ChevronUp className="w-3 h-3" /></button>
                              <button type="button" onClick={() => moveBullet(exp.id, bi, 1)} disabled={bi === exp.bullets.length - 1} className="text-[#6b6b6b] hover:text-[#1a1a1a] disabled:opacity-30"><ChevronDown className="w-3 h-3" /></button>
                            </div>
                            <GripVertical className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                            <Input value={bullet} onChange={(e) => updateBullet(exp.id, bi, e.target.value)} placeholder="Led the migration to React, reducing load time by 40%" className="text-sm flex-1" />
                            <button type="button" onClick={() => removeBullet(exp.id, bi)} className="text-[#6b6b6b] hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                          </div>
                        ))}
                        <div className="flex items-center gap-4 mt-1 flex-wrap">
                          <button type="button" onClick={() => addBullet(exp.id)} className="text-xs text-[#1f5c3a] flex items-center gap-1 hover:underline w-fit"><Plus className="w-3 h-3" />Add bullet</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addExp} className="mt-3 text-sm text-[#1f5c3a] font-medium flex items-center gap-1.5 hover:underline"><Plus className="w-4 h-4" />Add another role</button>

                {/* Skills */}
                <div className="mt-8 pt-6 border-t border-stone-200">
                  <p className="text-sm font-semibold text-[#1a1a1a] mb-1">Skills <span className="text-xs text-[#6b6b6b] font-normal">(optional)</span></p>
                  <p className="text-xs text-[#6b6b6b] mb-3">Type a skill and press Enter or comma to add it.</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {skills.map((skill) => (
                      <span key={skill} className="flex items-center gap-1 text-sm bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full border border-[#1f5c3a]/20">
                        {skill}<button type="button" onClick={() => removeSkill(skill)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSkill(skillInput); } }}
                    onBlur={() => { if (skillInput.trim()) addSkill(skillInput); }}
                    placeholder="e.g. React, SQL, Power BI — press Enter to add" className="bg-white text-sm" />
                </div>
              </>
            )}
          </div>
        );

      case 2:
        return (
          <div>
            {/* Skipped banner */}
            {eduSkipped && (
              <div className="flex items-center justify-between mb-5 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                <p className="text-sm text-[#6b6b6b]">Education section skipped.</p>
                <button type="button" onClick={() => setEduSkipped(false)} className="text-xs text-[#1f5c3a] underline underline-offset-2 hover:opacity-80">Add education</button>
              </div>
            )}
            {!eduSkipped && (
              <>
                <p className="text-xs text-[#6b6b6b] mb-4">
                  Add your academic background. You can skip this section entirely if you prefer not to include education on your resume.
                </p>
                <div className="flex flex-col gap-4">
                  {education.map((edu, ei) => (
                    <div key={edu.id} className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#1a1a1a]">{edu.institution || `Education ${ei + 1}`}</p>
                        {education.length > 1 && <button type="button" onClick={() => removeEdu(edu.id)} className="text-[#6b6b6b] hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input value={edu.institution} onChange={(e) => updateEdu(edu.id, "institution", e.target.value)} placeholder="Institution name" className="text-sm" />
                        <Input value={edu.degree} onChange={(e) => updateEdu(edu.id, "degree", e.target.value)} placeholder="Degree e.g. B.Tech Computer Science" className="text-sm" />
                        <Input value={edu.year} onChange={(e) => updateEdu(edu.id, "year", e.target.value)} placeholder="Year e.g. 2022 or 2020–2024" className="text-sm" />
                        <Input value={edu.location} onChange={(e) => updateEdu(edu.id, "location", e.target.value)} placeholder="City / State" className="text-sm" />
                        <Input value={edu.cgpa} onChange={(e) => updateEdu(edu.id, "cgpa", e.target.value)} placeholder="CGPA / % (optional)" className="text-sm" />
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addEdu} className="mt-3 text-sm text-[#1f5c3a] font-medium flex items-center gap-1.5 hover:underline"><Plus className="w-4 h-4" />Add another entry</button>
              </>
            )}
          </div>
        );

      case 3:
        return (
          <div>
            {/* Skipped banner */}
            {projSkipped && (
              <div className="flex items-center justify-between mb-5 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                <p className="text-sm text-[#6b6b6b]">Projects section skipped.</p>
                <button type="button" onClick={() => setProjSkipped(false)} className="text-xs text-[#1f5c3a] underline underline-offset-2 hover:opacity-80">Add projects</button>
              </div>
            )}
            {!projSkipped && (
              <>
                <p className="text-xs text-[#6b6b6b] mb-4">Personal, academic, or open-source work. Great for freshers and career changers.</p>
                {projects.length === 0 && <p className="text-sm text-[#6b6b6b] mb-3">No projects added yet.</p>}
                <div className="flex flex-col gap-4">
                  {projects.map((proj, pi) => (
                    <div key={proj.id} className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#1a1a1a]">{proj.name || `Project ${pi + 1}`}</p>
                        <button type="button" onClick={() => removeProj(proj.id)} className="text-[#6b6b6b] hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                      </div>
                      <Input value={proj.name} onChange={(e) => updateProj(proj.id, "name", e.target.value)} placeholder="Project name" className="text-sm" />
                      <Textarea value={proj.description} onChange={(e) => updateProj(proj.id, "description", e.target.value)} placeholder="What did it do? What was your role and impact?" className="min-h-[80px] bg-white resize-none text-sm" />
                      <Input value={proj.tech.join(", ")} onChange={(e) => updateProjTech(proj.id, e.target.value)} placeholder="Tech stack, comma-separated e.g. React, Node.js, PostgreSQL" className="text-sm" />
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addProj} className="mt-3 text-sm text-[#1f5c3a] font-medium flex items-center gap-1.5 hover:underline"><Plus className="w-4 h-4" />Add project</button>
              </>
            )}

            {/* Extras: Certifications & Achievements (auto-filled from PDF when present) */}
            <div className="mt-8 pt-6 border-t border-stone-200">
              <p className="text-sm font-semibold text-[#1a1a1a] mb-1">Certifications &amp; achievements <span className="text-xs text-[#6b6b6b] font-normal">(optional)</span></p>
              <p className="text-xs text-[#6b6b6b] mb-4">Pre-filled from your uploaded resume when found. Type and press Enter to add more.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-xs font-medium text-[#1a1a1a] mb-2">Certifications</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {certifications.map((c) => (
                      <span key={c} className="flex items-center gap-1 text-sm bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full border border-[#1f5c3a]/20">
                        {c}<button type="button" onClick={() => removeCert(c)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {certifications.length === 0 && <p className="text-xs text-[#9ca3af] italic">None added.</p>}
                  </div>
                  <Input
                    value={certInput}
                    onChange={(e) => setCertInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCert(certInput); } }}
                    onBlur={() => { if (certInput.trim()) addCert(certInput); }}
                    placeholder="e.g. AWS Certified Solutions Architect"
                    className="bg-white text-sm"
                  />
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-xs font-medium text-[#1a1a1a] mb-2">Achievements / awards</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {achievements.map((a) => (
                      <span key={a} className="flex items-center gap-1 text-sm bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-200">
                        {a}<button type="button" onClick={() => removeAchievement(a)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    {achievements.length === 0 && <p className="text-xs text-[#9ca3af] italic">None added.</p>}
                  </div>
                  <Input
                    value={achievementInput}
                    onChange={(e) => setAchievementInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAchievement(achievementInput); } }}
                    onBlur={() => { if (achievementInput.trim()) addAchievement(achievementInput); }}
                    placeholder="e.g. Top 1% in National Math Olympiad"
                    className="bg-white text-sm"
                  />
                </div>
              </div>
            </div>

            {resumes.length > 0 && (
              <div className="mt-8 pt-6 border-t border-stone-200">
                <details className="group">
                  <summary className="text-xs text-[#6b6b6b] cursor-pointer hover:text-[#1a1a1a] list-none flex items-center gap-1">
                    <span className="group-open:hidden">▶</span><span className="hidden group-open:inline">▼</span> AI got something wrong in a previous resume? Report it
                  </summary>
                  <div className="mt-4 flex flex-col gap-3">
                    <select value={issueResumeId} onChange={(e) => setIssueResumeId(e.target.value)} className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1f5c3a]/40">
                      <option value="">Select a resume…</option>
                      {resumes.map((r) => (
                        <option key={r.id} value={r.id}>{r.tailored_role} — {new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</option>
                      ))}
                    </select>
                    <Textarea value={issueDesc} onChange={(e) => setIssueDesc(e.target.value)} placeholder="e.g. The AI added a skill I never mentioned, or experience bullets were completely wrong." className="min-h-[90px] bg-white resize-none text-sm" />
                    <Button variant="outline" onClick={submitIssue} disabled={submittingIssue} className="w-fit text-sm">{submittingIssue ? "Submitting…" : "Submit issue"}</Button>
                  </div>
                </details>
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <div>
            <p className="text-xs text-[#6b6b6b] mb-3">Pick up to 3. The AI tailors your resume keywords to these roles.</p>
            <div className="flex flex-wrap gap-2">
              {INDIAN_JOB_ROLES.map((role) => (
                <button key={role} type="button" onClick={() => toggleRole(role)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${targetRoles.includes(role) ? "bg-[#1f5c3a] text-white border-[#1f5c3a]" : "bg-white text-[#1a1a1a] border-stone-200 hover:border-[#1f5c3a]"}`}>
                  {targetRoles.includes(role) && <X className="inline w-3 h-3 mr-1 -mt-0.5" />}{role}
                </button>
              ))}
            </div>
            {targetRoles.length > 0 && <p className="text-sm text-[#1f5c3a] font-medium mt-3">Selected: {targetRoles.join(", ")}</p>}
          </div>
        );

      default: return null;
    }
  }

  // ── Right-panel checklist data ─────────────────────────────────────────
  const profileSteps = [
    { label: "Basics",     required: true,  done: sec1Done, skipped: false },
    { label: "Experience", required: false, done: experience.some((e) => e.company.trim()) || isFresher, skipped: expSkipped && !experience.some((e) => e.company.trim()) },
    { label: "Education",  required: false, done: education.some((e) => e.institution.trim()), skipped: eduSkipped && !education.some((e) => e.institution.trim()) },
    { label: "Projects",   required: false, done: projects.some((p) => p.name.trim()), skipped: projSkipped && !projects.some((p) => p.name.trim()) },
    { label: "Roles",      required: true,  done: sec2Done, skipped: false },
  ];
  const mandatoryPending = profileSteps.filter((s) => s.required && !s.done).map((s) => s.label);
  const canGenerate = mandatoryPending.length === 0;

  // Skip handler for current step
  const skipHandlers: Record<number, (() => void) | undefined> = {
    1: handleSkipExperience,
    2: handleSkipEducation,
    3: handleSkipProjects,
  };
  const canSkipStep = [false, !isFresher, true, true, false];

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      
      {/* Two-column wrapper on desktop */}
      {/* scroll-padding-top ensures anchored scrolls clear the sticky header + stepper (~7rem) */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-8 items-start" style={{ scrollPaddingTop: "8rem" }}>

        {/* ── Left: form column ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {saveLabel && (
            <div className="flex justify-end mb-3">
              <span className={`text-xs font-medium ${saveStatus === "error" ? "text-red-500" : "text-[#1f5c3a]"}`}>{saveLabel}</span>
            </div>
          )}
          {fromPreview && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <strong>Updating your profile?</strong> Make your changes here, then{" "}
              <Link href="/create" className="underline underline-offset-2 font-semibold">generate a new resume</Link>.
              {fromResumeId && <span className="ml-1">Regenerating uses 1 credit (free within 24 h of the same JD).</span>}
            </div>
          )}
          {/* Scroll anchor — the form card scrolls into view on step change */}
          <div ref={formTopRef} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-6 scroll-mt-32">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[#1a1a1a]">{STEPS[currentStep].label}</h2>
              <p className="text-xs text-[#6b6b6b] mt-0.5">
                {STEPS[currentStep].required ? (
                  <span className="inline-flex items-center gap-1 text-[#1f5c3a] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1f5c3a] inline-block" />Required
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#6b6b6b]">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 inline-block" />Optional — you can skip this section
                  </span>
                )}{" "}
                — {STEPS[currentStep].description}
              </p>
            </div>
            {renderStep()}
            <StepNav
              current={currentStep}
              onBack={handleBack}
              onNext={handleNext}
              nextDisabled={nextDisabled}
              onSkip={skipHandlers[currentStep]}
              canSkip={canSkipStep[currentStep]}
            />
          </div>
        </div>

        {/* ── Right: persistent Generate CTA panel ──────────────────────── */}
        {/* top-32 = AppHeader (3.5rem) + GlobalStepper (~3.5rem) + 1rem gap */}
        <div className="lg:w-72 shrink-0">
          <div className="sticky top-32 bg-white rounded-2xl border border-stone-200 shadow-sm p-5 flex flex-col gap-4">
            <p className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide">Profile checklist</p>

            <ul className="flex flex-col gap-2">
              {profileSteps.map((s) => (
                <li key={s.label} className="flex items-center gap-2.5">
                  {s.done ? (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#1f5c3a] shrink-0">
                      <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  ) : s.skipped ? ( <span className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-stone-400 border-dashed bg-stone-50 shrink-0" title="Skipped"><span className="text-[11px] text-stone-500 leading-none">–</span></span> ) : s.required ? (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-amber-400 shrink-0">
                      <span className="text-[9px] font-bold text-amber-500">!</span>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-stone-300 shrink-0" />
                  )}
                  <span className={`text-sm ${
                    s.done ? "text-[#1f5c3a] font-medium" : s.skipped ? "text-stone-500 italic" : s.required ? "text-amber-700 font-medium" : "text-[#6b6b6b]"
                  }`}>
                    {s.label}
                    {!s.required && <span className="ml-1 text-[10px] text-stone-400 font-normal">(optional)</span>}
                  </span>
                </li>
              ))}
            </ul>

            {!canGenerate && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-snug">
                Still needed: <strong>{mandatoryPending.join(", ")}</strong>
              </p>
            )}

            <div className="border-t border-stone-100" />

            <div className="flex flex-col items-center gap-2">
              <Button
                asChild={canGenerate}
                disabled={!canGenerate}
                className="w-full text-sm font-semibold py-5 rounded-xl"
              >
                {canGenerate ? (
                  <Link href="/create">Generate my resume →</Link>
                ) : (
                  <span>Generate my resume →</span>
                )}
              </Button>
              {canGenerate && (
                <p className="text-[11px] text-[#6b6b6b] text-center">Paste a job description on the next screen to tailor your resume.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f7f3ea]"><div className="flex items-center justify-center min-h-[60vh]"><p className="text-[#6b6b6b]">Loading profile…</p></div></div>}>
      <ProfilePageInner />
    </Suspense>
  );
}
