import Link from "next/link";
import { FreeBetaCard } from "@/components/beta/FreeBetaCard";
import { FREE_BETA_LABEL } from "@/lib/plan-config";

// Free Beta: no paid plans or checkout until payments are integrated. The
// /pricing route stays (older links and bookmarks point here) and explains
// the beta instead. The paid plan UI (./PricingClient.tsx) is not rendered.
export const metadata = { title: `${FREE_BETA_LABEL} — Neduresume` };

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#f7f3ea] px-4 py-16">
      <div className="max-w-2xl mx-auto text-center mb-10">
        <h1 className="font-serif italic text-4xl text-[#1a1a1a] mb-3">Neduresume is in free beta</h1>
        <p className="text-[#6b6b6b]">Every account gets 3 AI-tailored resume generations, free. No card, no subscription.</p>
      </div>
      <FreeBetaCard cta={{ href: "/signup", label: "Create your free account →" }} />
      <p className="text-center text-sm text-[#6b6b6b] mt-6">
        Already have an account? <Link href="/login" className="underline">Sign in</Link> or go to your <Link href="/dashboard" className="underline">dashboard</Link>.
      </p>
    </main>
  );
}
