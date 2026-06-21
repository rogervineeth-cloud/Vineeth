"use client";
import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Upload, Link2, FileText, PenLine, Briefcase, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileData } from "@/lib/profile-data";

// ── Types ──────────────────────────────────────────────────────────────────
type Path = "linkedin" | "resume" | "scratch";

type ExtractedProfile = {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  graduation_year?: number | null;
  summary?: string | null;
  experience?: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  education?: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  skills?: string[];
  projects?: Array<{ name: string; description: string; tech: string[] }>;
  certifications?: string[];
  achievements?: string[];
};

const basicsSchema = z.object({
  full_name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().optional(),
  current_city: z.string().optional(),
  graduation_year: z.string().optional(),
});

type BasicsData = z.infer<typeof basicsSchema>;

// ── Component ──────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();

  // Auto-select candidate type from landing page CTA
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const pathParam = params.get("path");
    if (pathParam === "experienced") { setCandidateType("experienced"); setStep(0); }
    else if (pathParam === "fresher") { setCandidateType("fresher"); setStep(0); }
  }, []);

  // step -1 = candidate type, 0 = path selection, 1 = upload, 2 = basics
  const [candidateType, setCandidateType] = useState<"experienced" | "fresher" | null>(null);
  const [path, setPath] = useState<Path | null>(null);
  const [step, setStep] = useState(-1);

  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [extractedProfile, setExtractedProfile] = useState<ExtractedProfile | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<BasicsData>({
    resolver: zodResolver(basicsSchema),
  });

  const isFresher = candidateType === "fresher";
  // scratch path skips upload step
  const isScratch = path === "scratch";


  // ── Path selection ─────────────────────────────────────────────────────
  function choosePath(chosen: Path) {
    setPath(chosen);
    setStep(chosen === "scratch" ? 2 : 1);
  }
  function chooseType(type: "experienced" | "fresher") {
    setCandidateType(type);
    setStep(0);
  }

  // ── Upload handler ────────────────────────────────────────────────────
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadDone(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-resume", { method: "POST", body: form });
      const data = await res.json();
      if (data.error && !data.extracted) {
        toast.error(data.error || "Couldn't parse the file. You can fill in your details below.");
        return;
      }
      const ep: ExtractedProfile = data.extracted ?? {};
      setExtractedProfile(ep);
      setUploadDone(true);
      if (ep.name) setValue("full_name", ep.name);
      if (ep.email) setValue("email", ep.email);
      if (ep.phone) setValue("phone", ep.phone);
      if (ep.city) setValue("current_city", ep.city);
      if (ep.graduation_year) setValue("graduation_year", String(ep.graduation_year));
      const extracted: string[] = [];
      if ((ep.experience?.length ?? 0) > 0) extracted.push("experience");
      if ((ep.education?.length ?? 0) > 0) extracted.push("education");
      if ((ep.skills?.length ?? 0) > 0) extracted.push("skills");
      if ((ep.projects?.length ?? 0) > 0) extracted.push("projects");
      if ((ep.certifications?.length ?? 0) > 0) extracted.push("certifications");
      if ((ep.achievements?.length ?? 0) > 0) extracted.push("achievements");
      if (extracted.length > 0) {
        toast.success(`Resume parsed — ${extracted.join(", ")} extracted. Review your details in Step 3.`);
      } else if (data.partial) {
        toast.warning("We could read the file but couldn't extract structured data. Fill in your details below.");
      } else {
        toast.success("File parsed — contact details extracted. You can fill in experience and education on your profile.");
      }
    } catch {
      toast.error("Upload failed. Fill in your details manually.");
    } finally {
      setUploading(false);
    }
  }, [setValue]);

  // ── Save and redirect ──────────────────────────────────────────────────
  async function onSubmitBasics(data: BasicsData) {
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Session expired — please sign in again.");
      router.push("/login");
      return;
    }
    const profileData: ProfileData | null = extractedProfile ? {
      summary: extractedProfile.summary ?? undefined,
      experience: extractedProfile.experience ?? [],
      education: extractedProfile.education ?? [],
      skills: extractedProfile.skills ?? [],
      projects: extractedProfile.projects ?? [],
      certifications: extractedProfile.certifications ?? [],
      achievements: extractedProfile.achievements ?? [],
    } : null;
    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      full_name: data.full_name,
      email: data.email,
      phone: data.phone || null,
      current_city: data.current_city || null,
      graduation_year: data.graduation_year ? parseInt(data.graduation_year) : null,
      profile_data: profileData,
      onboarded_at: new Date().toISOString(),
    });
    if (error) {
      const msg = error.code === "42501"
        ? "Permission denied — please sign out and sign in again."
        : `Couldn't save profile: ${error.message}`;
      setSaveError(msg);
      toast.error(msg);
      setSaving(false);
      return;
    }
    // Send to profile page — the stepper will guide them through all steps
    router.push("/profile?from=onboarding");
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      

      <div className="max-w-2xl mx-auto px-6 py-12">



        {/* ── STEP -1: Candidate type selection ── */}
        {step === -1 && (
          <div className="flex flex-col gap-8">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">Welcome to Neduresume AI</h1>
              <p className="text-[#6b6b6b] text-sm">Tell us about yourself so we can tailor the experience for you.</p>
            </div>
            <div className="flex flex-col gap-4">
              {/* Experienced */}
              <button
                type="button"
                onClick={() => chooseType("experienced")}
                className="group text-left bg-white border-2 border-stone-200 hover:border-[#1f5c3a] rounded-xl p-6 flex items-start gap-5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-[#1f5c3a]/10 flex items-center justify-center shrink-0 group-hover:bg-[#1f5c3a]/15 transition-colors">
                  <Briefcase className="w-6 h-6 text-[#1f5c3a]" />
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] mb-1">I&apos;m an experienced professional</p>
                  <p className="text-sm text-[#6b6b6b]">You have work experience and want to create a resume tailored to a specific job description. Upload your LinkedIn or existing resume to get started fast.</p>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <span className="text-[10px] bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full">Import from LinkedIn</span>
                    <span className="text-[10px] bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full">Upload existing resume</span>
                    <span className="text-[10px] bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full">Auto-fills your profile</span>
                  </div>
                </div>
              </button>
              {/* Fresher */}
              <button
                type="button"
                onClick={() => chooseType("fresher")}
                className="group text-left bg-white border-2 border-stone-200 hover:border-[#1f5c3a] rounded-xl p-6 flex items-start gap-5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
                  <GraduationCap className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] mb-1">I&apos;m a fresher / recent graduate</p>
                  <p className="text-sm text-[#6b6b6b]">You&apos;re just starting out or recently graduated. Upload a college resume or your LinkedIn PDF if you have one, or build your profile from scratch.</p>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Upload college resume</span>
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Import from LinkedIn</span>
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Start from scratch</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 0: Path selection ── */}
        {step === 0 && (
          <div className="flex flex-col gap-8">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">
                {isFresher ? "How would you like to start?" : "Import your existing experience"}
              </h1>
              <p className="text-[#6b6b6b] text-sm">
                {isFresher
                  ? "Upload a college resume or LinkedIn PDF if you have one, or start fresh — we'll guide you through each section."
                  : "Upload your LinkedIn PDF or existing resume and we'll pre-fill your entire profile automatically."}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Option A: LinkedIn PDF */}
              <button
                type="button"
                onClick={() => choosePath("linkedin")}
                className="group text-left bg-white border-2 border-stone-200 hover:border-[#1f5c3a] rounded-xl p-6 flex items-start gap-5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-[#0077b5]/10 flex items-center justify-center shrink-0 group-hover:bg-[#0077b5]/15 transition-colors">
                  <Link2 className="w-6 h-6 text-[#0077b5]" />
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] mb-1">Import from LinkedIn</p>
                  <p className="text-sm text-[#6b6b6b]">Export your LinkedIn profile as a PDF and upload it. We&apos;ll extract your experience, education, and skills automatically.</p>
                  <p className="text-xs text-[#6b6b6b] mt-2 italic">LinkedIn → Me → View profile → More → Save to PDF</p>
                </div>
              </button>

              {/* Option B: Existing resume */}
              <button
                type="button"
                onClick={() => choosePath("resume")}
                className="group text-left bg-white border-2 border-stone-200 hover:border-[#1f5c3a] rounded-xl p-6 flex items-start gap-5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-[#1f5c3a]/10 flex items-center justify-center shrink-0 group-hover:bg-[#1f5c3a]/15 transition-colors">
                  <FileText className="w-6 h-6 text-[#1f5c3a]" />
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] mb-1">Upload my existing resume</p>
                  <p className="text-sm text-[#6b6b6b]">Upload a PDF of your current resume. We&apos;ll read it and pre-fill your profile — you can edit anything before generating.</p>
                  <p className="text-xs text-[#6b6b6b] mt-2 italic">Supports any PDF resume · Max 5MB</p>
                </div>
              </button>

              {/* Option C: From scratch */}
              <button
                type="button"
                onClick={() => choosePath("scratch")}
                className="group text-left bg-white border-2 border-stone-200 hover:border-[#1f5c3a] rounded-xl p-6 flex items-start gap-5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
                  <PenLine className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold text-[#1a1a1a] mb-1">I&apos;ll fill it in myself</p>
                  <p className="text-sm text-[#6b6b6b]">No PDF? No problem. Enter your basic details and complete your full profile on the next screen — the stepper will guide you through each section.</p>
                  <p className="text-xs text-[#6b6b6b] mt-2 italic">Good for freshers or anyone starting fresh</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1: Upload (LinkedIn or resume) ── */}
        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">
                {path === "linkedin" ? "Upload your LinkedIn PDF" : "Upload your resume"}
              </h1>
              <p className="text-[#6b6b6b] text-sm">
                {path === "linkedin"
                  ? "Go to LinkedIn → Me → View profile → More → Save to PDF. Then upload it here."
                  : "Upload your existing resume as a PDF. We'll extract your details automatically."}
              </p>
            </div>

            <label className="border-2 border-dashed border-stone-300 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-[#1f5c3a] transition-colors bg-white">
              <Upload className="w-8 h-8 text-[#6b6b6b]" />
              <span className="text-sm font-medium text-[#1a1a1a]">
                {uploading ? "Parsing your file…" : uploadDone ? "✓ File parsed successfully" : "Click to upload PDF"}
              </span>
              <span className="text-xs text-[#6b6b6b]">PDF only · Max 5MB</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>

            {uploadDone && extractedProfile && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 flex flex-col gap-1">
                <p className="font-medium">✓ Extracted successfully</p>
                <ul className="text-xs space-y-0.5 mt-1">
                  {extractedProfile.name && <li>· Name: {extractedProfile.name}</li>}
                  {(extractedProfile.experience?.length ?? 0) > 0 && <li>· {extractedProfile.experience!.length} work experience {extractedProfile.experience!.length === 1 ? "entry" : "entries"}</li>}
                  {(extractedProfile.education?.length ?? 0) > 0 && <li>· {extractedProfile.education!.length} education {extractedProfile.education!.length === 1 ? "entry" : "entries"}</li>}
                  {(extractedProfile.skills?.length ?? 0) > 0 && <li>· {extractedProfile.skills!.length} skills</li>}
                  {(extractedProfile.certifications?.length ?? 0) > 0 && <li>· {extractedProfile.certifications!.length} certification{extractedProfile.certifications!.length === 1 ? "" : "s"}</li>}
                  {(extractedProfile.achievements?.length ?? 0) > 0 && <li>· {extractedProfile.achievements!.length} achievement{extractedProfile.achievements!.length === 1 ? "" : "s"}</li>}
                </ul>
                <p className="text-xs mt-1 text-green-700">You can review and edit everything on your profile page.</p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setStep(0)} className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] underline underline-offset-4">
                ← Back
              </button>
              <div className="flex items-center gap-3">
                {!uploadDone && (
                  <button type="button" onClick={() => setStep(2)} className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] underline underline-offset-4">
                    Skip — fill manually
                  </button>
                )}
                <Button onClick={() => setStep(2)} disabled={uploading}>
                  Continue
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Confirm basics ── */}
        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">Your basic details</h1>
              <p className="text-[#6b6b6b] text-sm">
                {extractedProfile
                  ? "We've pre-filled these from your uploaded file. Edit anything that looks wrong."
                  : "These will appear on your resume. You can change them any time from your profile."}
              </p>
              <p className="text-xs text-[#6b6b6b] mt-1">
                Your target job roles, experience, education, and skills will be set up on the next screen using the step-by-step guide.
              </p>
            </div>

            {saveError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{saveError}</div>
            )}

            <form onSubmit={handleSubmit(onSubmitBasics)} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="full_name">Full name <span className="text-red-500">*</span></Label>
                  <Input id="full_name" placeholder="Your full name" {...register("full_name")} />
                  {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                  <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
                  {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="phone">Phone <span className="text-xs text-[#6b6b6b] font-normal">(optional)</span></Label>
                  <Input id="phone" placeholder="+91 98765 43210" {...register("phone")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="current_city">Current city <span className="text-xs text-[#6b6b6b] font-normal">(optional)</span></Label>
                  <Input id="current_city" placeholder="e.g. Kochi" {...register("current_city")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="graduation_year">Graduation year <span className="text-xs text-[#6b6b6b] font-normal">(optional)</span></Label>
                  <Input id="graduation_year" inputMode="numeric" placeholder="e.g. 2022" {...register("graduation_year")} />
                </div>
              </div>

              {extractedProfile && (
                <div className="bg-[#1f5c3a]/5 border border-[#1f5c3a]/20 rounded-lg px-4 py-3 text-sm text-[#1a1a1a]">
                  <p className="font-medium mb-0.5">Profile data ready to save</p>
                  <p className="text-xs text-[#6b6b6b]">
                    Your experience, education, and skills extracted from the file will be saved and editable on your profile page.
                  </p>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button type="button" variant="ghost" onClick={() => setStep(isScratch ? 0 : 1)}>Back</Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Continue to profile →"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
