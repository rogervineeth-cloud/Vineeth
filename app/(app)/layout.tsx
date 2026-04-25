"use client";
import { usePathname } from "next/navigation";
import GlobalStepper from "@/components/nav/GlobalStepper";

const HIDE_STEPPER = ["/dashboard", "/pricing", "/profile", "/create"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideStepper = HIDE_STEPPER.some(p => pathname.startsWith(p));
  return (
    <>
      {!hideStepper && <GlobalStepper />}
      {children}
    </>
  );
}
