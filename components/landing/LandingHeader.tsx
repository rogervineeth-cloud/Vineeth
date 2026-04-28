"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function LandingHeader() {
  return (
    <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/95 backdrop-blur-sm z-10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer bg-transparent border-0 p-0"
          aria-label="Go to top"
        >
          <span className="font-serif italic text-xl text-[#1f5c3a] font-bold">Neduresume</span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-[#1f5c3a]/70 tracking-wide">
            powered by AI
          </span>
        </button>
        <nav className="flex items-center gap-6">
          <a
            href="#pricing"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors hidden sm:block"
          >
            Pricing
          </a>
          <Link href="/login" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">Sign in</Link>
          <Button size="sm" asChild className="text-sm bg-[#1f5c3a] hover:bg-[#174d30]">
            <Link href="/signup">Get started free →</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
