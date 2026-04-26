"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const STEPS = [
  { label: "Profile", href: "/profile" },
  { label: "Target job", href: "/create" },
  { label: "Review", href: null },
  { label: "Download", href: null },
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

  return (
    <div
      className="sticky z-20 border-b"
      style={{
        top: "3.5rem",
        background: "#f7f3ea",
        borderColor: "rgba(0,0,0,0.06)",
      }}
    >
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-center gap-4">
        {STEPS.map((step, i) => {
          const isCompleted = i < active;
          const isActive = i === active;
          const resolvedHref = i === 2 && latestResumeId ? `/preview/${latestResumeId}` : step.href;

          const circle = (
            <div
              className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-all"
              style={{
                background: isCompleted || isActive ? "#1f5c3a" : "transparent",
                border: `2px solid ${isCompleted || isActive ? "#1f5c3a" : "#9ca3af"}`,
                color: isCompleted || isActive ? "white" : "#9ca3af",
              }}
            >
              {isCompleted ? "✓" : i + 1}
            </div>
          );

          const label = (
            <span
              className="text-xs"
              style={{
                color: isActive ? "#1a1a1a" : isCompleted ? "#1f5c3a" : "#9ca3af",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {step.label}
            </span>
          );

          const inner = (
            <div className="flex flex-col items-center gap-0.5">
              {circle}
              {label}
            </div>
          );

          return (
            <div key={i} className="flex items-center gap-4">
              {resolvedHref ? (
                <Link href={resolvedHref} className="flex flex-col items-center gap-0.5 hover:opacity-75 transition-opacity">
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
                    width: 24,
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
