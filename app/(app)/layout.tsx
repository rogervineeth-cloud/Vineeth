"use client";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import GlobalStepper from "@/components/nav/GlobalStepper";

const NO_STEPPER_PATHS = ["/onboarding"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideStepper = NO_STEPPER_PATHS.some((p) => pathname.startsWith(p));
  return (
    <>
      {/* AppHeader MUST come first in the DOM so it sticks at top: 0 above the stepper */}
      <AppHeader />
      {/* GlobalStepper sticks at top: 3.5rem (below the header) */}
      {!hideStepper && <GlobalStepper />}
      {children}
    </>
  );
}
