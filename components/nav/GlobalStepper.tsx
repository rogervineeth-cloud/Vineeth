"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const STEPS = [
  { label: "Profile", href: "/profile" },
  { label: "Generate", href: "/create" },
  { label: "Resume", href: null as string | null },
];

function getActiveStep(pathname: string) {
  if (pathname.startsWith("/profile")) return 0;
  if (pathname.startsWith("/create")) return 1;
  if (pathname.startsWith("/preview")) return 2;
  return -1;
}

export default function GlobalStepper({ latestResumeId }: { latestResumeId?: string }) {
  const pathname = usePathname();
  const active = getActiveStep(pathname);
  if (active < 0) return null;

  return (
    <div
      className="sticky z-20 border-b"
      style={{
        top: "3.5rem",
        background: "#f7f3ea",
        borderColor: "rgba(0,0,0,0.06)",
      }}
    >
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-center gap-6">
        {STEPS.map((step, i) => {
          const isCompleted = i < active;
          const isActive = i === active;
          const resolvedHref = i === 2 && latestResumeId ? '/preview/' + latestResumeId : step.href;

          const circle = (
            <div
              className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all"
              style={{
                background: isCompleted || isActive ? "#1f5c3a" : "transparent",
                border: '2px solid ' + (isCompleted || isActive ? "#1f5c3a" : "#9ca3af"),
                color: isCompleted || isActive ? "white" : "#9ca3af",
              }}
            >
              {isCompleted ? "✓" : i + 1}
            </div>
          );

          const label = (
            <span
              className="text-sm"
              style={{
                color: isActive ? "#1a1a1a" : isCompleted ? "#1f5c3a" : "#9ca3af",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {step.label}
            </span>
          );

          const inner = (
            <div className="flex items-center gap-2">
              {circle}
              {label}
            </div>
          );

          return (
            <div key={i} className="flex items-center gap-6">
              {resolvedHref ? (
                <Link href={resolvedHref} className="flex items-center gap-2 hover:opacity-75 transition-opacity">
                  {circle}
                  {label}
                </Link>
              ) : (
                inner
              )}
              {i < STEPS.length - 1 && (
                <div
                  className="h-px"
                  style={{
                    width: 32,
                    background: i < active ? "#1f5c3a" : "#d1d5db",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
