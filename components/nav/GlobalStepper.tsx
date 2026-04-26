"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

const STEPS = [
  { key: "basics", label: "Basics", route: "/profile", subStep: "basics" },
  { key: "roles", label: "Roles", route: "/profile", subStep: "roles" },
  { key: "experience", label: "Experience", route: "/profile", subStep: "experience" },
  { key: "education", label: "Education", route: "/profile", subStep: "education" },
  { key: "projects", label: "Projects", route: "/profile", subStep: "projects" },
  { key: "jd", label: "Job Description", route: "/create", subStep: "jd" },
  { key: "template", label: "Template", route: "/create", subStep: "template" },
  { key: "resume", label: "Resume", route: "/preview", subStep: "" },
] as const;

function getActiveStep(pathname: string, stepParam: string | null): number {
  if (pathname.startsWith("/preview")) return 7;
  if (pathname.startsWith("/create")) {
    if (stepParam === "template") return 6;
    return 5;
  }
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
  const stepParam = searchParams.get("step");
  const active = getActiveStep(pathname, stepParam);
  if (active < 0) return null;
  const total = STEPS.length;

  return (
    <div
      className="sticky z-20 border-b"
      style={{ top: "3.5rem", background: "#f7f3ea", borderColor: "rgba(0,0,0,0.06)" }}
    >
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto">
          {STEPS.map((step, i) => {
            const isCompleted = i < active;
            const isActive = i === active;
            const lastResumeHref = step.key === "resume" && latestResumeId ? '/preview/' + latestResumeId : null;
            const baseHref = step.route + (step.subStep ? '?step=' + step.subStep : '');
            const href = lastResumeHref || baseHref;
            const clickable = isCompleted; // forward-only: only completed steps clickable

            const circle = (
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all shrink-0"
                style={{
                  background: isCompleted || isActive ? "#1f5c3a" : "transparent",
                  border: '2px solid ' + (isCompleted || isActive ? "#1f5c3a" : "#9ca3af"),
                  color: isCompleted || isActive ? "white" : "#9ca3af",
                }}
                aria-current={isActive ? "step" : undefined}
              >
                {isCompleted ? "✓" : i + 1}
              </div>
            );
            const label = (
              <span
                className="text-xs sm:text-sm whitespace-nowrap"
                style={{
                  color: isActive ? "#1a1a1a" : isCompleted ? "#1f5c3a" : "#9ca3af",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {step.label}
              </span>
            );
            const inner = (
              <div className="flex items-center gap-1.5">{circle}{label}</div>
            );
            return (
              <div key={step.key} className="flex items-center gap-1 sm:gap-2 shrink-0">
                {clickable ? (
                  <Link href={href} className="flex items-center gap-1.5 hover:opacity-75 transition-opacity">
                    {circle}{label}
                  </Link>
                ) : inner}
                {i < STEPS.length - 1 && (
                  <div
                    className="h-px"
                    style={{ width: 16, background: i < active ? "#1f5c3a" : "#d1d5db" }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-center text-[11px] text-[#6b6b6b] mt-2">
          Step {active + 1} of {total}
        </p>
      </div>
    </div>
  );
}

export default function GlobalStepper({ latestResumeId }: { latestResumeId?: string }) {
  return (
    <Suspense fallback={null}>
      <StepperInner latestResumeId={latestResumeId} />
    </Suspense>
  );
}
