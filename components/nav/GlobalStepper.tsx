"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const STEPS = [
  { key: "basics",     label: "Basics",    route: "/profile", subStep: "basics",     optional: false },
  { key: "experience", label: "Experience", route: "/profile", subStep: "experience", optional: true  },
  { key: "education",  label: "Education",  route: "/profile", subStep: "education",  optional: true  },
  { key: "projects",   label: "Projects",   route: "/profile", subStep: "projects",   optional: true  },
  { key: "roles",      label: "Roles",      route: "/profile", subStep: "roles",      optional: false },
  { key: "jd",         label: "Job Desc",   route: "/create",  subStep: "",           optional: false },
  { key: "template",   label: "Template",   route: "/create",  subStep: "template",   optional: false },
  { key: "review",     label: "Review",     route: "/create",  subStep: "review",     optional: false },
  { key: "resume",     label: "Resume",     route: "/preview", subStep: "",           optional: false },
] as const;

type StepKey = typeof STEPS[number]["key"];

function getActiveStep(pathname: string, stepParam: string | null): number {
  if (pathname.startsWith("/preview")) return 8;
  if (pathname.startsWith("/create")) {
    if (stepParam === "resume") return 8;
    if (stepParam === "review") return 7;
    if (stepParam === "template") return 6;
    return 5;
  }
  if (pathname.startsWith("/profile")) {
    const map: Record<string, number> = { basics: 0, experience: 1, education: 2, projects: 3, roles: 4 };
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
  const [completion, setCompletion] = useState<Record<StepKey, boolean>>({
    basics: false, roles: false, experience: false, education: false,
    projects: false, jd: false, template: false, review: false, resume: false,
  });

  // Tracks steps the user explicitly skipped (only optional steps).
  // We persist this in profile_data JSONB so the stepper can render a 3rd state
  // ("skipped") that's visually distinct from "completed" and "not visited yet".
  type SkipKey = "experience" | "education" | "projects";
  const [skipped, setSkipped] = useState<Record<SkipKey, boolean>>({ experience: false, education: false, projects: false });

  useEffect(() => {
    if (active < 0) { setLoaded(true); return; }
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) { setLoaded(true); return; }
        const { data: p } = await supabase.from("profiles").select("full_name, email, target_roles, linkedin_data, profile_data").eq("user_id", user.id).single();
        if (cancelled) return;
        const ld = (p?.linkedin_data ?? {}) as Record<string, unknown>;
        const pd = (p?.profile_data ?? {}) as Record<string, unknown>;
        const exp = (Array.isArray(pd.experience) && pd.experience.length > 0)
          ? pd.experience as { company?: string }[]
          : (Array.isArray(ld.experience) ? ld.experience as { company?: string }[] : []);
        const edu = (Array.isArray(pd.education) && pd.education.length > 0)
          ? pd.education as { institution?: string }[]
          : (Array.isArray(ld.education) ? ld.education as { institution?: string }[] : []);
        const projects = (Array.isArray(pd.projects) && pd.projects.length > 0)
          ? pd.projects as { name?: string }[]
          : (Array.isArray(ld.projects) ? ld.projects as { name?: string }[] : []);
        const jd = typeof window !== "undefined" ? (localStorage.getItem("ndrs_jd") ?? "") : "";
        const template = typeof window !== "undefined" ? (localStorage.getItem("ndrs_template") ?? "") : "";
        const resumeId = latestResumeId ?? (typeof window !== "undefined" ? (localStorage.getItem("ndrs_latest_resume_id") ?? "") : "");
        if (cancelled) return;
        setCompletion({
          basics: !!p?.full_name?.trim() && !!p?.email?.trim(),
          roles: Array.isArray(p?.target_roles) && p.target_roles.length > 0,
          experience: exp.some((e) => e.company?.trim()),
          education: edu.some((e) => e.institution?.trim()),
          projects: projects.some((pr) => pr.name?.trim()),
          jd: jd.trim().length >= 200,
          template: !!template,
          review: !!(jd.trim().length >= 200 && template),
          resume: !!resumeId,
        });
        setSkipped({
          experience: !!pd?.expSkipped,
          education:  !!pd?.eduSkipped,
          projects:   !!pd?.projSkipped,
        });
        setLoaded(true);
      } catch { setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [active, pathname, latestResumeId]);

  // Forward-only enforcement: redirect to basics if incomplete
  useEffect(() => {
    if (!loaded || active < 1 || active >= 8) return;
    const order: StepKey[] = ["basics", "experience", "education", "projects", "roles", "jd", "template", "review", "resume"];
    for (let i = 0; i < active; i++) {
      const key = order[i];
      if (key === "basics" && !completion[key]) {
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
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-3">
        {/* All 9 steps in a single scrollable row — no overflow clipping */}
        <div className="flex items-center justify-between w-full min-w-0">
          {STEPS.map((step, i) => {
            const isPast = i < active;
            // A step is "skipped" if user explicitly clicked Skip on it (only Experience/Education/Projects).
            const stepKey = step.key as string;
            const isSkipped = isPast && (stepKey === "experience" || stepKey === "education" || stepKey === "projects") && (skipped as Record<string, boolean>)[stepKey] && !completion[step.key];
            const isCompleted = isPast && (completion[step.key] || (step.optional && !isSkipped));
            const isActive = i === active;
            const lastResumeHref = step.key === "resume" && latestResumeId ? "/preview/" + latestResumeId : null;
            const baseHref = step.route + (step.subStep ? "?step=" + step.subStep : "");
            const href = lastResumeHref || baseHref;
            const clickable = isPast && !isActive;

            const circle = (
              <div
                className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all shrink-0"
                style={{
                  background: isCompleted || isActive ? "#1f5c3a" : "transparent",
                  border: "2px " + (isSkipped ? "dashed #9ca3af" : "solid " + (isCompleted || isActive ? "#1f5c3a" : "#9ca3af")),
                  color: isCompleted || isActive ? "white" : isSkipped ? "#6b6b6b" : "#9ca3af",
                }}
                aria-current={isActive ? "step" : undefined}
              >
                {isCompleted && !isActive ? "✓" : isSkipped ? "–" : i + 1}
              </div>
            );

            const label = (
              <span
                className="hidden sm:inline text-[11px] whitespace-nowrap leading-tight"
                style={{
                  color: isActive ? "#1a1a1a" : isCompleted ? "#1f5c3a" : isSkipped ? "#6b6b6b" : "#9ca3af",
                  fontWeight: isActive ? 600 : 400,
                  fontStyle: isSkipped ? "italic" : "normal",
                }}
              >
                {step.label}
              </span>
            );

            const inner = (
              <div className="flex items-center gap-1">
                {circle}
                {label}
              </div>
            );

            return (
              <div key={step.key} className="flex items-center min-w-0 shrink">
                {clickable ? (
                  <Link href={href} className="flex items-center gap-1 hover:opacity-75 transition-opacity">
                    {inner}
                  </Link>
                ) : inner}
                {i < STEPS.length - 1 && (
                  <div
                    className="shrink mx-1"
                    style={{
                      height: 1,
                      minWidth: 4,
                      flex: "1 1 8px",
                      maxWidth: 20,
                      background: isCompleted ? "#1f5c3a" : isSkipped ? "#9ca3af" : "#d1d5db",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-center text-[10px] text-[#6b6b6b] mt-1.5">Step {active + 1} of {total}</p>
      </div>
    </div>
  );
}

export default function GlobalStepper({ latestResumeId }: { latestResumeId?: string }) {
  return (<Suspense fallback={null}><StepperInner latestResumeId={latestResumeId} /></Suspense>);
}
