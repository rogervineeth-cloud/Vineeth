"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const STEPS = [
  { key: "basics", label: "Basics", route: "/profile", subStep: "basics" },
  { key: "roles", label: "Roles", route: "/profile", subStep: "roles" },
  { key: "experience", label: "Experience", route: "/profile", subStep: "experience" },
  { key: "education", label: "Education", route: "/profile", subStep: "education" },
  { key: "projects", label: "Projects", route: "/profile", subStep: "projects" },
  { key: "jd", label: "Job Description", route: "/create", subStep: "" },
  { key: "template", label: "Template", route: "/create", subStep: "" },
  { key: "resume", label: "Resume", route: "/preview", subStep: "" },
] as const;

type StepKey = typeof STEPS[number]["key"];

function getActiveStep(pathname: string, stepParam: string | null): number {
  if (pathname.startsWith("/preview")) return 7;
  if (pathname.startsWith("/create")) return 5;
  if (pathname.startsWith("/profile")) {
    const map: Record<string, number> = { basics: 0, roles: 1, experience: 2, education: 3, projects: 4 };
    if (stepParam && stepParam in map) return map[stepParam];
    return 0;
  }
  return -1;
}

function StepperInner({ latestResumeId }: { latestResumeId?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const stepParam = searchParams.get("step");
  const active = getActiveStep(pathname, stepParam);

  const [loaded, setLoaded] = useState(false);
  const [completion, setCompletion] = useState<Record<StepKey, boolean>>({ basics: false, roles: false, experience: false, education: false, projects: false, jd: false, template: false, resume: false });

  useEffect(() => {
    if (active < 0) { setLoaded(true); return; }
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) { setLoaded(true); return; }
        const { data: p } = await supabase.from("profiles").select("full_name, email, target_roles, linkedin_data").eq("user_id", user.id).single();
        if (cancelled) return;
        const ld = (p?.linkedin_data ?? {}) as Record<string, unknown>;
        const exp = Array.isArray(ld.experience) ? ld.experience : [];
        const edu = Array.isArray(ld.education) ? ld.education : [];
        const projects = Array.isArray(ld.projects) ? ld.projects : [];
        const jd = typeof window !== "undefined" ? (localStorage.getItem("ndrs_jd") ?? "") : "";
        const template = typeof window !== "undefined" ? (localStorage.getItem("ndrs_template") ?? "") : "";
        setCompletion({
          basics: !!p?.full_name?.trim() && !!p?.email?.trim(),
          roles: Array.isArray(p?.target_roles) && p.target_roles.length > 0,
          experience: exp.length > 0,
          education: edu.length > 0,
          projects: projects.length > 0,
          jd: jd.trim().length >= 200,
          template: !!template,
          resume: !!latestResumeId,
        });
        setLoaded(true);
      } catch { setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [active, pathname, latestResumeId]);

  // Forward-only enforcement: if user is at step N but step N-1 is incomplete, redirect to first incomplete
  useEffect(() => {
    if (!loaded || active < 5) return;
    const order: StepKey[] = ["basics", "roles", "experience", "education", "projects", "jd", "template", "resume"];
    for (let i = 0; i < active; i++) {
      const key = order[i];
      if (!completion[key]) {
        const target = STEPS[i];
        const url = target.subStep ? target.route + "?step=" + target.subStep : target.route;
        router.replace(url);
        return;
      }
    }
  }, [loaded, completion, active, router]);

  if (active < 0) return null;
  const total = STEPS.length;

  return (
    <div className="sticky z-20 border-b" style={{ top: "3.5rem", background: "#f7f3ea", borderColor: "rgba(0,0,0,0.06)" }}>
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto">
          {STEPS.map((step, i) => {
            const isCompleted = completion[step.key];
            const isActive = i === active;
            const lastResumeHref = step.key === "resume" && latestResumeId ? "/preview/" + latestResumeId : null;
            const baseHref = step.route + (step.subStep ? "?step=" + step.subStep : "");
            const href = lastResumeHref || baseHref;
            const clickable = isCompleted && !isActive;
            const circle = (
              <div className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all shrink-0" style={{ background: isCompleted || isActive ? "#1f5c3a" : "transparent", border: "2px solid " + (isCompleted || isActive ? "#1f5c3a" : "#9ca3af"), color: isCompleted || isActive ? "white" : "#9ca3af" }} aria-current={isActive ? "step" : undefined}>
                {isCompleted && !isActive ? "✓" : i + 1}
              </div>
            );
            const label = (
              <span className="text-xs sm:text-sm whitespace-nowrap" style={{ color: isActive ? "#1a1a1a" : isCompleted ? "#1f5c3a" : "#9ca3af", fontWeight: isActive ? 600 : 400 }}>{step.label}</span>
            );
            return (
              <div key={step.key} className="flex items-center gap-1 sm:gap-2 shrink-0">
                {clickable ? (
                  <Link href={href} className="flex items-center gap-1.5 hover:opacity-75 transition-opacity">{circle}{label}</Link>
                ) : (
                  <div className="flex items-center gap-1.5">{circle}{label}</div>
                )}
                {i < STEPS.length - 1 && (
                  <div className="h-px" style={{ width: 16, background: isCompleted ? "#1f5c3a" : "#d1d5db" }} />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-center text-[11px] text-[#6b6b6b] mt-2">Step {active + 1} of {total}</p>
      </div>
    </div>
  );
}

export default function GlobalStepper({ latestResumeId }: { latestResumeId?: string }) {
  return (<Suspense fallback={null}><StepperInner latestResumeId={latestResumeId} /></Suspense>);
}
