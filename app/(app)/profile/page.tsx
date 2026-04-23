"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, X, GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { INDIAN_JOB_ROLES } from "@/lib/seed/roles";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────
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

// ── Save indicator ─────────────────────────────────────────────────────────
type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── Main component ─────────────────────────────────────────────────────────
function ProfilePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPreview = searchParams.get("from") === "preview";
  const fromResumeId = searchParams.get("resumeId") ?? "";

  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Basic info
  const [basics, setBasics] = useState<BasicInfo>({
    full_name: "", email: "", phone: "", current_city: "", graduation_year: "",
  });

  // Target roles
  const [targetRoles, setTargetRoles] = useState<string[]>([]);

  // Rich profile fields
  const [summary, setSummary] = useState("");
  const [experience, setExperience] = useState<ExpEntry[]>([emptyExp()]);
  const [skills, setSkills] = useState<string[]>([]);
  const [education, setEducation] = useState<EduEntry[]>([emptyEdu()]);
  const [projects, setProjects] = useState<ProjEntry[]>([]);

  // Skills input
  const [skillInput, setSkillInput] = useState("");

  // Issue reporter
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [issueResumeId, setIssueResumeId] = useState("");
  const [issueDesc, setIssueDesc] = useState("");
  const [submittingIssue, setSubmittingIssue] = useState(false);

  // ── Load profile on mount ────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);

      const [profileRes, resumesRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).single(),
        supabase.from("resumes")
          .select("id,tailored_role,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (profileRes.data) {
        const p = profileRes.data;
        setBasics({
          full_name: p.full_name ?? "",
          email: p.email ?? "",
          phone: p.phone ?? "",
          current_city: p.current_city ?? "",
          graduation_year: p.graduation_year ? String(p.graduation_year) : "",
        });
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

  // ── Auto-save (debounced 1s) ─────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (!userId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      const supabase = createClient();
      const profileData = {
        summary,
        experience: experience.map(({ id: _id, ...rest }) => rest),
        skills,
        education: education.map(({ id: _id, ...rest }) => rest),
        projects: projects.map(({ id: _id, ...rest }) => rest),
      };
      const { error } = await supabase.from("profiles").update({
        full_name: basics.full_name,
        email: basics.email,
        phone: basics.phone || null,
        current_city: basics.current_city || null,
        graduation_year: basics.graduation_year ? parseInt(basics.graduation_year) : null,
        target_roles: targetRoles,
        profile_data: profileData,
      }).eq("user_id", userId);

      setSaveStatus(error ? "error" : "saved");
      if (error) toast.error("Auto-save failed: " + error.message);
    }, 1000);
  }, [userId, basics, targetRoles, summary, experience, skills, education, projects]);

  useEffect(() => {
    if (!loaded) return;
    scheduleSave();
  }, [loaded, basics, targetRoles, summary, experience, skills, education, projects, scheduleSave]);

  // ── Target roles ─────────────────────────────────────────────────────────
  function toggleRole(role: string) {
    setTargetRoles((prev) => {
      if (prev.includes(role)) return prev.filter((r) => r !== role);
      if (prev.length >= 3) { toast.info("Pick up to 3 roles."); return prev; }
      return [...prev, role];
    });
  }

  // ── Experience ───────────────────────────────────────────────────────────
  function updateExp(id: string, field: keyof Omit<ExpEntry, "id" | "bullets">, val: string) {
    setExperience((prev) => prev.map((e) => e.id === id ? { ...e, [field]: val } : e));
  }
  function addExp() { setExperience((prev) => [...prev, emptyExp()]); }
  function removeExp(id: string) { setExperience((prev) => prev.filter((e) => e.id !== id)); }

  function updateBullet(expId: string, bi: number, val: string) {
    setExperience((prev) => prev.map((e) => {
      if (e.id !== expId) return e;
      const bullets = [...e.bullets];
      bullets[bi] = val;
      return { ...e, bullets };
    }));
  }
  function addBullet(expId: string) {
    setExperience((prev) => prev.map((e) =>
      e.id === expId ? { ...e, bullets: [...e.bullets, ""] } : e
    ));
  }
  function removeBullet(expId: string, bi: number) {
    setExperience((prev) => prev.map((e) => {
      if (e.id !== expId) return e;
      const bullets = e.bullets.filter((_, i) => i !== bi);
      return { ...e, bullets: bullets.length ? bullets : [""] };
    }));
  }
  function moveBullet(expId: string, bi: number, dir: -1 | 1) {
    setExperience((prev) => prev.map((e) => {
      if (e.id !== expId) return e;
      const bullets = [...e.bullets];
      const ni = bi + dir;
      if (ni < 0 || ni >= bullets.length) return e;
      [bullets[bi], bullets[ni]] = [bullets[ni], bullets[bi]];
      return { ...e, bullets };
    }));
  }

  // ── Skills ───────────────────────────────────────────────────────────────
  function addSkill(val: string) {
    const trimmed = val.trim();
    if (!trimmed || skills.includes(trimmed)) return;
    setSkills((prev) => [...prev, trimmed]);
    setSkillInput("");
  }
  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((s) => s !== skill));
  }

  // ── Education ────────────────────────────────────────────────────────────
  function updateEdu(id: string, field: keyof Omit<EduEntry, "id">, val: string) {
    setEducation((prev) => prev.map((e) => e.id === id ? { ...e, [field]: val } : e));
  }
  function addEdu() { setEducation((prev) => [...prev, emptyEdu()]); }
  function removeEdu(id: string) { setEducation((prev) => prev.filter((e) => e.id !== id)); }

  // ── Projects ─────────────────────────────────────────────────────────────
  function updateProj(id: string, field: keyof Omit<ProjEntry, "id" | "tech">, val: string) {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, [field]: val } : p));
  }
  function updateProjTech(id: string, val: string) {
    setProjects((prev) => prev.map((p) =>
      p.id === id ? { ...p, tech: val.split(",").map((t) => t.trim()).filter(Boolean) } : p
    ));
  }
  function addProj() { setProjects((prev) => [...prev, emptyProj()]); }
  function removeProj(id: string) { setProjects((prev) => prev.filter((p) => p.id !== id)); }

  // ── Issue reporter ───────────────────────────────────────────────────────
  async function submitIssue() {
    if (!issueResumeId) { toast.error("Select a resume."); return; }
    if (issueDesc.trim().length < 20) { toast.error("Please describe the issue (min 20 chars)."); return; }
    if (!userId) return;
    setSubmittingIssue(true);
    const supabase = createClient();
    const { error } = await supabase.from("generation_issues").insert({
      user_id: userId,
      resume_id: issueResumeId,
      description: issueDesc.trim(),
    });
    setSubmittingIssue(false);
    if (error) { toast.error("Couldn't submit issue: " + error.message); return; }
    toast.success("Issue reported — we'll review and may refund your credit.");
    setIssueResumeId("");
    setIssueDesc("");
  }

  // ── Save status label ────────────────────────────────────────────────────
  const saveLabel = saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : saveStatus === "error" ? "Save failed" : "";

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[#f7f3ea]">
        <AppHeader />
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-[#6b6b6b]">Loading profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <AppHeader />

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="font-serif italic text-3xl text-[#1a1a1a]">Your profile</h1>
            <p className="text-sm text-[#6b6b6b] mt-1">Everything here feeds into your AI-generated resumes. Edit freely — changes save automatically.</p>
          </div>
          <div className="flex items-center gap-3">
            {saveLabel && (
              <span className={`text-xs font-medium ${saveStatus === "error" ? "text-red-500" : "text-[#1f5c3a]"}`}>
                {saveLabel}
              </span>
            )}
            <Button asChild>
              <Link href="/create">Generate resume →</Link>
            </Button>
          </div>
        </div>

        {/* From-preview banner */}
        {fromPreview && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <strong>Updating your profile?</strong> Make your changes here, then{" "}
            <Link href="/create" className="underline underline-offset-2 font-semibold">generate a new resume</Link>.
            {fromResumeId && (
              <span className="ml-1">Regenerating uses 1 credit (free within 24 h of the same JD).</span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-8">
          {/* ── Basic info ── */}
          <Section title="Basic info">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full name *">
                <Input value={basics.full_name} onChange={(e) => setBasics((b) => ({ ...b, full_name: e.target.value }))} placeholder="Your full name" />
              </Field>
              <Field label="Email *">
                <Input type="email" value={basics.email} onChange={(e) => setBasics((b) => ({ ...b, email: e.target.value }))} placeholder="you@example.com" />
              </Field>
              <Field label="Phone">
                <Input value={basics.phone} onChange={(e) => setBasics((b) => ({ ...b, phone: e.target.value }))} placeholder="+91 98765 43210" />
              </Field>
              <Field label="Current city">
                <Input value={basics.current_city} onChange={(e) => setBasics((b) => ({ ...b, current_city: e.target.value }))} placeholder="e.g. Kochi" />
              </Field>
              <Field label="Graduation year">
                <Input value={basics.graduation_year} onChange={(e) => setBasics((b) => ({ ...b, graduation_year: e.target.value }))} inputMode="numeric" placeholder="e.g. 2022" />
              </Field>
            </div>
          </Section>

          {/* ── Target roles ── */}
          <Section title="Target roles" subtitle="Pick up to 3. The AI will tailor keywords to these roles.">
            <div className="flex flex-wrap gap-2">
              {INDIAN_JOB_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    targetRoles.includes(role)
                      ? "bg-[#1f5c3a] text-white border-[#1f5c3a]"
                      : "bg-white text-[#1a1a1a] border-stone-200 hover:border-[#1f5c3a]"
                  }`}
                >
                  {targetRoles.includes(role) && <X className="inline w-3 h-3 mr-1 -mt-0.5" />}
                  {role}
                </button>
              ))}
            </div>
            {targetRoles.length > 0 && (
              <p className="text-sm text-[#1f5c3a] font-medium mt-2">Selected: {targetRoles.join(", ")}</p>
            )}
          </Section>

          {/* ── Summary ── */}
          <Section title="Professional summary" subtitle="Optional. 2-3 sentences about your experience and career goal.">
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Software engineer with 3 years of experience in full-stack development, specialising in React and Node.js. Looking for a senior role in product-led companies."
              className="min-h-[100px] bg-white resize-none text-sm"
            />
          </Section>

          {/* ── Experience ── */}
          <Section
            title="Work experience"
            subtitle="Add your roles. Bullets should start with action verbs."
            action={<button type="button" onClick={addExp} className="text-sm text-[#1f5c3a] font-medium flex items-center gap-1 hover:underline"><Plus className="w-4 h-4" />Add role</button>}
          >
            {experience.map((exp, ei) => (
              <div key={exp.id} className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#1a1a1a]">{exp.company || `Role ${ei + 1}`}</p>
                  {experience.length > 1 && (
                    <button type="button" onClick={() => removeExp(exp.id)} className="text-[#6b6b6b] hover:text-red-500 transition-colors shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input value={exp.company} onChange={(e) => updateExp(exp.id, "company", e.target.value)} placeholder="Company name" className="text-sm" />
                  <Input value={exp.role} onChange={(e) => updateExp(exp.id, "role", e.target.value)} placeholder="Your role / title" className="text-sm" />
                  <Input value={exp.duration} onChange={(e) => updateExp(exp.id, "duration", e.target.value)} placeholder="Duration e.g. Jan 2022 – Mar 2024" className="text-sm" />
                  <Input value={exp.location} onChange={(e) => updateExp(exp.id, "location", e.target.value)} placeholder="Location e.g. Bengaluru" className="text-sm" />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[#6b6b6b] font-medium">Bullets (start with action verbs):</p>
                  {exp.bullets.map((bullet, bi) => (
                    <div key={bi} className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => moveBullet(exp.id, bi, -1)} disabled={bi === 0} className="text-[#6b6b6b] hover:text-[#1a1a1a] disabled:opacity-30">
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => moveBullet(exp.id, bi, 1)} disabled={bi === exp.bullets.length - 1} className="text-[#6b6b6b] hover:text-[#1a1a1a] disabled:opacity-30">
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                      <GripVertical className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                      <Input
                        value={bullet}
                        onChange={(e) => updateBullet(exp.id, bi, e.target.value)}
                        placeholder="Led the migration of legacy PHP app to React, reducing load time by 40%"
                        className="text-sm flex-1"
                      />
                      <button type="button" onClick={() => removeBullet(exp.id, bi)} className="text-[#6b6b6b] hover:text-red-500 transition-colors shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addBullet(exp.id)} className="text-xs text-[#1f5c3a] flex items-center gap-1 hover:underline mt-1 w-fit">
                    <Plus className="w-3 h-3" />Add bullet
                  </button>
                </div>
              </div>
            ))}
          </Section>

          {/* ── Skills ── */}
          <Section
            title="Skills"
            subtitle="Type a skill and press Enter or comma to add it."
          >
            <div className="flex flex-wrap gap-1.5 mb-2">
              {skills.map((skill) => (
                <span key={skill} className="flex items-center gap-1 text-sm bg-[#1f5c3a]/10 text-[#1f5c3a] px-2.5 py-1 rounded-full border border-[#1f5c3a]/20">
                  {skill}
                  <button type="button" onClick={() => removeSkill(skill)} className="hover:text-red-500 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addSkill(skillInput);
                }
              }}
              onBlur={() => { if (skillInput.trim()) addSkill(skillInput); }}
              placeholder="e.g. React, SQL, Power BI — press Enter to add"
              className="bg-white text-sm"
            />
          </Section>

          {/* ── Education ── */}
          <Section
            title="Education"
            action={<button type="button" onClick={addEdu} className="text-sm text-[#1f5c3a] font-medium flex items-center gap-1 hover:underline"><Plus className="w-4 h-4" />Add entry</button>}
          >
            {education.map((edu, ei) => (
              <div key={edu.id} className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#1a1a1a]">{edu.institution || `Education ${ei + 1}`}</p>
                  {education.length > 1 && (
                    <button type="button" onClick={() => removeEdu(edu.id)} className="text-[#6b6b6b] hover:text-red-500 transition-colors shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
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
          </Section>

          {/* ── Projects ── */}
          <Section
            title="Projects"
            subtitle="Optional. Include personal, academic, or open-source work."
            action={<button type="button" onClick={addProj} className="text-sm text-[#1f5c3a] font-medium flex items-center gap-1 hover:underline"><Plus className="w-4 h-4" />Add project</button>}
          >
            {projects.length === 0 && (
              <p className="text-sm text-[#6b6b6b]">No projects added yet.</p>
            )}
            {projects.map((proj, pi) => (
              <div key={proj.id} className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[#1a1a1a]">{proj.name || `Project ${pi + 1}`}</p>
                  <button type="button" onClick={() => removeProj(proj.id)} className="text-[#6b6b6b] hover:text-red-500 transition-colors shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Input value={proj.name} onChange={(e) => updateProj(proj.id, "name", e.target.value)} placeholder="Project name" className="text-sm" />
                <Textarea value={proj.description} onChange={(e) => updateProj(proj.id, "description", e.target.value)} placeholder="What did it do? What was your contribution and impact?" className="min-h-[80px] bg-white resize-none text-sm" />
                <Input value={proj.tech.join(", ")} onChange={(e) => updateProjTech(proj.id, e.target.value)} placeholder="Tech stack, comma-separated e.g. React, Node.js, PostgreSQL" className="text-sm" />
              </div>
            ))}
          </Section>

          {/* ── Generate CTA ── */}
          <div className="bg-[#1f5c3a]/5 border border-[#1f5c3a]/20 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-[#1a1a1a]">Ready to generate?</p>
              <p className="text-sm text-[#6b6b6b]">Paste a job description and we&apos;ll tailor this profile into a resume in ~25 seconds.</p>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/create">Generate resume →</Link>
            </Button>
          </div>

          {/* ── Issue reporter ── */}
          <Section
            title="Report a generation issue"
            subtitle="Did the AI get something wrong in a previous resume? Let us know — we may refund your credit."
          >
            {resumes.length === 0 ? (
              <p className="text-sm text-[#6b6b6b]">No resumes generated yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <Field label="Which resume?">
                  <select
                    value={issueResumeId}
                    onChange={(e) => setIssueResumeId(e.target.value)}
                    className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1f5c3a]/40"
                  >
                    <option value="">Select a resume…</option>
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.tailored_role} — {new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Describe the issue">
                  <Textarea
                    value={issueDesc}
                    onChange={(e) => setIssueDesc(e.target.value)}
                    placeholder="e.g. The AI added a skill I never mentioned, or experience bullets were completely wrong."
                    className="min-h-[100px] bg-white resize-none text-sm"
                  />
                </Field>
                <Button
                  variant="outline"
                  onClick={submitIssue}
                  disabled={submittingIssue}
                  className="w-fit"
                >
                  {submittingIssue ? "Submitting…" : "Submit issue"}
                </Button>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Small layout helpers ───────────────────────────────────────────────────
function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-[#1a1a1a]">{title}</h2>
          {subtitle && <p className="text-xs text-[#6b6b6b] mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
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

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f7f3ea]"><div className="flex items-center justify-center min-h-[60vh]"><p className="text-[#6b6b6b]">Loading profile…</p></div></div>}>
      <ProfilePageInner />
    </Suspense>
  );
}
