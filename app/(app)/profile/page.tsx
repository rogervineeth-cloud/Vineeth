"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  X,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { INDIAN_JOB_ROLES } from "@/lib/seed/roles";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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
  { label: "Basics", required: true },
  { label: "Roles", required: true },
  { label: "Experience", required: false },
  { label: "Education", required: true },
  { label: "Projects", required: false },
  { label: "Review", required: false },
] as const;

// ── Horizontal stepper UI ─────────────────────────────────────────────────
function HorizontalStepper({
  current,
  completed,
  onStepClick,
}: {
  current: number;
  completed: boolean[];
  onStepClick: (i: number) => void;
}) {
  return (
    <>
      {/* Desktop stepper */}
      <div className="hidden">
        <div
          className="absolute top-4 h-px bg-stone-200 z-0"
          style={{ left: "calc(10% + 1rem)", right: "calc(10% + 1rem)" }}
        />
        {STEPS.map((step, i) => {
          const isDone = completed[i];
          const isCurrent = i === current;
          return (
            <button
              key={step.label}
              type="button"
              onClick={() => onStepClick(i)}
              className="flex flex-col items-center gap-1.5 relative z-10 min-w-[60px] group focus:outline-none"
            >
              <div
                className={`flex items-center justify-center rounded-full font-bold transition-all duration-200 ${
                  isCurrent
                    ? "w-9 h-9 text-sm bg-[#1f5c3a] text-white shadow-md ring-2 ring-[#1f5c3a]/30"
                    : isDone
                    ? "w-8 h-8 text-sm bg-[#1f5c3a] text-white"
                    : "w-8 h-8 text-sm bg-white border-2 border-[#1f5c3a] text-[#1f5c3a] group-hover:bg-[#1f5c3a]/5"
                }`}
              >
                {isDone ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs font-medium transition-colors ${isCurrent ? "text-[#1f5c3a]" : "text-[#6b6b6b] group-hover:text-[#1a1a1a]"}`}>
                {step.label}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${step.required ? "bg-[#1f5c3a]/10 text-[#1f5c3a]" : "bg-stone-100 text-[#6b6b6b]"}`}>
                {step.required ? "Required" : "Optional"}
              </span>
            </button>
          );
        })}
      </div>
      {/* Mobile */}
      <div className="flex sm:hidden items-center justify-between mb-6">
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <button key={i} type="button" onClick={() => onStepClick(i)}
              className={`rounded-full transition-all ${i === current ? "w-6 h-2 bg-[#1f5c3a]" : completed[i] ? "w-2 h-2 bg-[#1f5c3a]/60" : "w-2 h-2 bg-stone-300"}`}
            />
          ))}
        </div>
        <span className="text-sm text-[#6b6b6b]">
          Step <span className="font-semibold text-[#1a1a1a]">{current + 1}</span> of 6 —{" "}
          <span className="font-semibold text-[#1a1a1a]">{STEPS[current].label}</span>
        </span>
      </div>
    </>
  );
}

function StepNav({ current, onBack, onNext }: { current: number; onBack: () => void; onNext: () => void; }) {
  const isReview = current === STEPS.length - 1;
  return (
    <div className="flex items-center justify-between mt-8 pt-6 border-t border-stone-200">
      <Button variant="outline" onClick={onBack} disabled={current === 0} className="gap-1.5">
        <ChevronLeft className="w-4 h-4" />Back
      </Button>
      {!isReview && (
        <Button onClick={onNext} className="gap-1.5">Next<ChevronRight className="w-4 h-4" /></Button>
      )}
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

  const STEP_KEYS = ["basics", "roles", "experience", "education", "projects", "review"];  const [currentStep, setCurrentStep] = useState(() => { if (typeof window === "undefined") return 0; const p = new URLSearchParams(window.location.search).get("step"); const i = STEP_KEYS.indexOf(p || ""); return i >= 0 ? i : 0; });  useEffect(() => { if (typeof window === "undefined") return; const url = new URL(window.location.href); url.searchParams.set("step", STEP_KEYS[currentStep] || "basics"); window.history.replaceState({}, "", url.toString()); }, [currentStep]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [basics, setBasics] = useState<BasicInfo>({ full_name: "", email: "", phone: "", current_city: "", graduation_year: "" });
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [experience, setExperience] = useState<ExpEntry[]>([emptyExp()]);
  const [skills, setSkills] = useState<string[]>([]);
  const [education, setEducation] = useState<EduEntry[]>([emptyEdu()]);
  const [projects, setProjects] = useState<ProjEntry[]>([]);
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
        setBasics({ full_name: p.full_name ?? "", email: p.email ?? "", phone: p.phone ?? "", current_city: p.current_city ?? "", graduation_year: p.graduation_year ? String(p.graduation_year) : "" });
        setTargetRoles(p.target_roles ?? []);
        const pd = p.profile_data ?? {};
        if (pd.summary) setSummary(pd.summary);
        if (pd.experience?.length) setExperience(pd.experience.map((e: Omit<ExpEntry, "id">) => ({ ...e, id: uid() })));
        if (pd.skills?.length) setSkills(pd.skills);
        if (pd.education?.length) setEducation(pd.education.map((e: Omit<EduEntry, "id">) => ({ ...e, id: uid() })));
        if (pd.projects?.length) setProjects(pd.projects.map((e: Omit<ProjEntry, "id">) => ({ ...e, id: uid() })));
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
      const profileData = {
        summary,
        experience: experience.map((e) => ({ company: e.company, role: e.role, duration: e.duration, location: e.location, bullets: e.bullets })),
        skills,
        education: education.map((e) => ({ institution: e.institution, degree: e.degree, year: e.year, location: e.location, cgpa: e.cgpa })),
        projects: projects.map((p) => ({ name: p.name, description: p.description, tech: p.tech })),
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
  }, [userId, basics, targetRoles, summary, experience, skills, education, projects]);

  useEffect(() => {
    if (!loaded) return;
    scheduleSave();
  }, [loaded, basics, targetRoles, summary, experience, skills, education, projects, scheduleSave]);

  const sec1Done = !!(basics.full_name.trim() && basics.email.trim());
  const sec2Done = targetRoles.length > 0;
  const sec3Done = experience.some((e) => e.company.trim());
  const sec4Done = education.some((e) => e.institution.trim());
  const sec5Done = projects.some((p) => p.name.trim());
  const completed = [sec1Done, sec2Done, sec3Done, sec4Done, sec5Done, true];

  function handleNext() {
    if (currentStep === 0 && !sec1Done) toast.info("Add your name and email — they appear on every resume.");
    else if (currentStep === 1 && !sec2Done) toast.info("Pick at least one target role so the AI knows what to tailor for.");
    else if (currentStep === 3 && !sec4Done) toast.info("Add at least one education entry.");
    if (currentStep < STEPS.length - 1) setCurrentStep((s) => s + 1);
  }
  function handleBack() { if (currentStep > 0) setCurrentStep((s) => s - 1); }

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

  function addSkill(val: string) { const t = val.trim(); if (!t || skills.includes(t)) return; setSkills((prev) => [...prev, t]); setSkillInput(""); }
  function removeSkill(skill: string) { setSkills((prev) => prev.filter((s) => s !== skill)); }

  function updateEdu(id: string, field: keyof Omit<EduEntry, "id">, val: string) { setEducation((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: val } : e))); }
  function addEdu() { setEducation((prev) => [...prev, emptyEdu()]); }
  function removeEdu(id: string) { setEducation((prev) => prev.filter((e) => e.id !== id)); }

  function updateProj(id: string, field: keyof Omit<ProjEntry, "id" | "tech">, val: string) { setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: val } : p))); }
  function updateProjTech(id: string, val: string) { setProjects((prev) => prev.map((p) => p.id === id ? { ...p, tech: val.split(",").map((t) => t.trim()).filter(Boolean) } : p)); }
  function addProj() { setProjects((prev) => [...prev, emptyProj()]); }
  function removeProj(id: string) { setProjects((prev) => prev.filter((p) => p.id !== id)); }

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
        <AppHeader />
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
              <Field label="Phone"><Input value={basics.phone} onChange={(e) => setBasics((b) => ({ ...b, phone: e.target.value }))} placeholder="+91 98765 43210" /></Field>
              <Field label="Current city"><Input value={basics.current_city} onChange={(e) => setBasics((b) => ({ ...b, current_city: e.target.value }))} placeholder="e.g. Kochi" /></Field>
              <Field label="Graduation year"><Input value={basics.graduation_year} onChange={(e) => setBasics((b) => ({ ...b, graduation_year: e.target.value }))} inputMode="numeric" placeholder="e.g. 2022" /></Field>
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
      case 2:
        return (
          <div>
            <p className="text-xs text-[#6b6b6b] mb-4">Add your work history. Start bullets with a strong action verb (Led, Built, Delivered…).</p>
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
                    <button type="button" onClick={() => addBullet(exp.id)} className="text-xs text-[#1f5c3a] flex items-center gap-1 hover:underline mt-1 w-fit"><Plus className="w-3 h-3" />Add bullet</button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addExp} className="mt-3 text-sm text-[#1f5c3a] font-medium flex items-center gap-1.5 hover:underline"><Plus className="w-4 h-4" />Add another role</button>
            <div className="mt-8 pt-6 border-t border-stone-200">
              <p className="text-sm font-semibold text-[#1a1a1a] mb-1">Skills</p>
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
          </div>
        );
      case 3:
        return (
          <div>
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
          </div>
        );
      case 4:
        return (
          <div>
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
      case 5:
        return (
          <div className="flex flex-col gap-6">
            {(basics.full_name.trim() || basics.email.trim()) && (
              <div>
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide mb-2">Basics</p>
                <div className="flex flex-col gap-0.5 text-sm">
                  {basics.full_name && <span className="font-medium text-[#1a1a1a]">{basics.full_name}</span>}
                  {basics.email && <span className="text-[#6b6b6b]">{basics.email}</span>}
                  {basics.phone && <span className="text-[#6b6b6b]">{basics.phone}</span>}
                  {basics.current_city && <span className="text-[#6b6b6b]">{basics.current_city}</span>}
                  {targetRoles.length > 0 && <span className="text-[#6b6b6b] mt-0.5">Targeting: {targetRoles.join(", ")}</span>}
                </div>
              </div>
            )}
            {experience.some((e) => e.company.trim()) && (
              <div>
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide mb-2">Experience</p>
                <div className="flex flex-col gap-3">
                  {experience.filter((e) => e.company.trim()).map((exp) => (
                    <div key={exp.id} className="bg-[#f7f3ea] rounded-lg p-3">
                      <p className="text-sm font-semibold text-[#1a1a1a]">{exp.role}{exp.role && exp.company ? " — " : ""}{exp.company}</p>
                      {(exp.duration || exp.location) && (
                        <p className="text-xs text-[#6b6b6b] mb-1.5">{exp.duration}{exp.location ? ` · ${exp.location}` : ""}</p>
                      )}
                      <ul className="flex flex-col gap-1">
                        {exp.bullets.filter((b) => b.trim()).slice(0, 3).map((b, i) => (
                          <li key={i} className="text-xs text-[#6b6b6b] flex gap-1.5">
                            <span className="text-[#1f5c3a] shrink-0">·</span>{b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {education.some((e) => e.institution.trim()) && (
              <div>
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide mb-2">Education</p>
                <div className="flex flex-col gap-2">
                  {education.filter((e) => e.institution.trim()).map((edu) => (
                    <div key={edu.id} className="bg-[#f7f3ea] rounded-lg p-3">
                      <p className="text-sm font-semibold text-[#1a1a1a]">{edu.degree}</p>
                      <p className="text-xs text-[#6b6b6b]">
                        {edu.institution}{edu.year ? ` · ${edu.year}` : ""}{edu.cgpa ? ` · ${edu.cgpa}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {skills.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill) => (
                    <span key={skill} className="text-xs bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full border border-[#1f5c3a]/20">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {summary.trim() && (
              <div>
                <p className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide mb-2">Summary</p>
                <p className="text-sm text-[#6b6b6b] leading-relaxed">{summary}</p>
              </div>
            )}
            <div className="flex flex-col gap-2 pt-2 border-t border-stone-100">
              <Button asChild className="w-full">
                <Link href="/create">Looks good — Create my resume →</Link>
              </Button>
              <button
                type="button"
                onClick={() => setCurrentStep(0)}
                className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors text-center py-1"
              >
                ← Edit profile
              </button>
            </div>
          </div>
        );
      default: return null;
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <AppHeader />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="font-serif italic text-3xl text-[#1a1a1a]">Your profile</h1>
            <p className="text-sm text-[#6b6b6b] mt-1">Changes save automatically.</p>
          </div>
          <div className="flex items-center gap-3">
            {saveLabel && <span className={`text-xs font-medium ${saveStatus === "error" ? "text-red-500" : "text-[#1f5c3a]"}`}>{saveLabel}</span>}
            <Button asChild><Link href="/create"></Link></Button>
          </div>
        </div>
        {fromPreview && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>Updating your profile?</strong> Make your changes here, then{" "}
            <Link href="/create" className="underline underline-offset-2 font-semibold">generate a new resume</Link>.
            {fromResumeId && <span className="ml-1">Regenerating uses 1 credit (free within 24 h of the same JD).</span>}
          </div>
        )}
        {/* Step progress */}
        <div className="flex justify-center mb-6 select-none">
          <div className="flex items-center">
            {([] as const).map(
              (label, i) => (
                <div key={label} className="flex items-center">
                  <div className="flex flex-col items-center gap-1 w-[60px]">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                        i === currentStep
                          ? "bg-[#1f5c3a] text-white ring-2 ring-[#1f5c3a]/20"
                          : i < currentStep
                          ? "bg-[#1f5c3a]/70 text-white"
                          : "bg-white border-2 border-stone-200 text-stone-400"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <span
                      className={`text-[10px] font-medium text-center leading-tight ${
                        i === currentStep ? "text-[#1f5c3a]" : "text-stone-400"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {i < 5 && <div className="w-6 h-px bg-stone-200 mb-4 mx-0.5" />}
                </div>
              )
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-6">
          <HorizontalStepper current={currentStep} completed={completed} onStepClick={setCurrentStep} />
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-[#1a1a1a]">{STEPS[currentStep].label}</h2>
            <p className="text-xs text-[#6b6b6b] mt-0.5">
              {STEPS[currentStep].required ? "Required" : "Optional"} —{" "}
              {currentStep === 0 && "Your contact details and a quick summary."}
              {currentStep === 1 && "The roles you're targeting — used to tailor every resume."}
              {currentStep === 2 && "Your work history and skills."}
              {currentStep === 3 && "Your academic background."}
              {currentStep === 4 && "Projects you've built or contributed to."}
              {currentStep === 5 && "Check everything looks right before generating."}
            </p>
          </div>
          {renderStep()}
          <StepNav current={currentStep} onBack={handleBack} onNext={handleNext} />
        </div>
        <div className="hidden rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-[#1a1a1a]">Ready to generate?</p>
            <p className="text-sm text-[#6b6b6b]">Paste a job description and we&apos;ll tailor this profile into a resume in under a minute.</p>
          </div>
          <Button asChild className="shrink-0"><Link href="/create"></Link></Button>
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
