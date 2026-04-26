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
      <div className="hidden sm:flex items-start justify-between relative mb-10">

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
        <div className="bg-[#1f5c3a]/5 border border-[#1f5c3a]/20 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-[#1a1a1a]">Ready to generate?</p>
            <p className="text-sm text-[#6b6b6b]">Paste a job description and we&apos;ll tailor this profile into a resume in under a minute.</p>
          </div>
          <Button asChild className="shrink-0"><Link href="/create">Generate resume →</Link></Button>
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
