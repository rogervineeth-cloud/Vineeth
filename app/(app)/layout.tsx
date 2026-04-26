"use client";
import { usePathname } from "next/navigation";
import GlobalStepper from "@/components/nav/GlobalStepper";

const NO_STEPPER_PATHS = ["/onboarding"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideStepper = NO_STEPPER_PATHS.some((p) => pathname.startsWith(p));
  return (
    <>
      {!hideStepper && <GlobalStepper />}
      {children}
    </>
  );
}
