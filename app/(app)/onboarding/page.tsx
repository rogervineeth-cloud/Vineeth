"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { INDIAN_JOB_ROLES } from "@/lib/seed/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppHeader } from "@/components/app-header";

const basicsSchema = z.object({
  full_name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  phone: z.string().optional(),
  current_city: z.string().optional(),
  graduation_year: z.string().optional(),
});

type BasicsData = z.infer<typeof basicsSchema>;

type ExtractedData = {
  name: string;
  email: string;
  phone: string;
  city: string;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [linkedinText, setLinkedinText] = useState("");
  const [linkedinData, setLinkedinData] = useState<Record<string, unknown>>({});
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<BasicsData>({
    resolver: zodResolver(basicsSchema),
  });

  // Step 1: LinkedIn PDF upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/parse-linkedin", { method: "POST", body: form });
      const data = await res.json();

      if (data.error) {
        toast.error("Couldn't parse the PDF. You can fill in your details manually below.");
        return;
      }

      setLinkedinText(data.text);
      setLinkedinData(data.extracted);

      const extracted: ExtractedData = data.extracted;
      if (extracted.name) setValue("full_name", extracted.name);
      if (extracted.email) setValue("email", extracted.email);
      if (extracted.phone) setValue("phone", extracted.phone);
      if (extracted.city) setValue("current_city", extracted.city);

      toast.success("LinkedIn PDF parsed — please check the extracted details below.");
    } catch {
      toast.error("Upload failed. Fill in your details manually.");
    } finally {
      setUploading(false);
    }
  }, [setValue]);

  // Step 2: Role selection
  function toggleRole(role: string) {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) return prev.filter((r) => r !== role);
      if (prev.length >= 3) {
        toast.info("Pick up to 3 roles.");
        return prev;
      }
      return [...prev, role];
    });
  }

  // Step 3: Save profile and redirect
  async function onSubmitBasics(data: BasicsData) {
    if (selectedRoles.length === 0) {
      toast.error("Please go back and pick at least one target role.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Session expired — please sign in again.");
      router.push("/login");
      return;
    }

    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      full_name: data.full_name,
      email: data.email,
      phone: data.phone ?? null,
      current_city: data.current_city ?? null,
      graduation_year: data.graduation_year ? parseInt(data.graduation_year) : null,
      linkedin_data: linkedinData,
      target_roles: selectedRoles,
      onboarded_at: new Date().toISOString(),
    });

    if (error) {
      toast.error("Couldn't save profile: " + error.message);
      setSaving(false);
      return;
    }

    toast.success("Profile saved! Let's build your first resume.");
    router.push("/create");
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <AppHeader />

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-10">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  s < step
                    ? "bg-[#1f5c3a] text-white"
                    : s === step
                    ? "bg-[#1f5c3a] text-white ring-2 ring-[#1f5c3a]/30 ring-offset-1"
                    : "bg-stone-200 text-[#6b6b6b]"
                }`}
              >
                {s < step ? "✓" : s}
              </div>
              {s < 3 && <div className={`h-px w-8 ${s < step ? "bg-[#1f5c3a]" : "bg-stone-200"}`} />}
            </div>
          ))}
          <span className="ml-2 text-xs text-[#6b6b6b]">Step {step} of 3</span>
        </div>

        {/* STEP 1: LinkedIn PDF */}
        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">Upload your LinkedIn PDF</h1>
              <p className="text-[#6b6b6b] text-sm">
                On LinkedIn: your profile → More → Save to PDF. Then upload here.
              </p>
            </div>

            <label className="border-2 border-dashed border-stone-300 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-[#1f5c3a] transition-colors bg-white">
              <Upload className="w-8 h-8 text-[#6b6b6b]" />
              <span className="text-sm font-medium text-[#1a1a1a]">
                {uploading ? "Parsing PDF…" : "Click to upload LinkedIn PDF"}
              </span>
              <span className="text-xs text-[#6b6b6b]">PDF only · Max 5MB</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>

            {linkedinText && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                ✓ PDF parsed successfully — details extracted below (you can edit them in Step 3).
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] underline underline-offset-4"
              >
                Skip — I&apos;ll fill manually
              </button>
              <Button onClick={() => setStep(2)} disabled={uploading}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Target roles */}
        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">What roles are you targeting?</h1>
              <p className="text-[#6b6b6b] text-sm">Pick up to 3. We&apos;ll use these to tailor your resume keywords.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {INDIAN_JOB_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    selectedRoles.includes(role)
                      ? "bg-[#1f5c3a] text-white border-[#1f5c3a]"
                      : "bg-white text-[#1a1a1a] border-stone-200 hover:border-[#1f5c3a]"
                  }`}
                >
                  {selectedRoles.includes(role) && (
                    <X className="inline w-3 h-3 mr-1 -mt-0.5" />
                  )}
                  {role}
                </button>
              ))}
            </div>

            {selectedRoles.length > 0 && (
              <p className="text-sm text-[#1f5c3a] font-medium">
                Selected: {selectedRoles.join(", ")}
              </p>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button
                onClick={() => {
                  if (selectedRoles.length === 0) {
                    toast.error("Pick at least one role.");
                    return;
                  }
                  setStep(3);
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Basics */}
        {step === 3 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-2">Confirm your basics</h1>
              <p className="text-[#6b6b6b] text-sm">These appear on your resume. Edit anything that looks wrong.</p>
            </div>

            <form onSubmit={handleSubmit(onSubmitBasics)} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="full_name">Full name *</Label>
                  <Input id="full_name" placeholder="Your full name" {...register("full_name")} />
                  {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
                  {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input id="phone" placeholder="+91 98765 43210" {...register("phone")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="current_city">Current city</Label>
                  <Input id="current_city" placeholder="e.g. Kochi" {...register("current_city")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="graduation_year">Graduation year</Label>
                  <Input id="graduation_year" type="number" placeholder="e.g. 2022" {...register("graduation_year")} />
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button type="button" variant="ghost" onClick={() => setStep(2)}>Back</Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Complete setup →"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
