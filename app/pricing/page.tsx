"use client";
import Link from "next/link";
import { Check, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/lib/plan-config";
import type { PlanType } from "@/lib/plan-config";
import { createClient } from "@/lib/supabase/client";

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "true";

function PlanCard({ plan }: { plan: typeof PLANS[number] }) {
  const [granting, setGranting] = useState(false);
  const router = useRouter();

  async function handleChoose() {
    // Check if user is already logged in
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // User is logged in — show payment coming soon toast and redirect to dashboard
      toast.info("Payment integration coming soon! Contact support@neduresume.com to get early access.", {
        duration: 5000,
        action: { label: "Go to Dashboard", onClick: () => router.push("/dashboard") },
      });
    } else {
      // Not logged in — send to signup with plan pre-selected
      router.push(`/signup?plan=${plan.type}`);
    }
  }

  async function handleGrantTest() {
    setGranting(true);
    try {
      const res = await fetch("/api/dev/grant-test-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_type: plan.type }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Grant failed.");
        return;
      }
      toast.success(`✓ ${plan.name} test plan granted — ${data.plan.resumes_allotted} credits, 1 year validity.`);
    } catch {
      toast.error("Grant failed.");
    } finally {
      setGranting(false);
    }
  }

  const isPopular = plan.popular;

  return (
    <div
      className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
        isPopular
          ? "border-[#1f5c3a] bg-[#1f5c3a] text-white shadow-lg"
          : "border-stone-200 bg-white"
      }`}
    >
      {isPopular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
          Most popular
        </span>
      )}

      <div>
        <p className={`text-sm font-medium mb-1 ${isPopular ? "text-white/80" : "text-[#6b6b6b]"}`}>
          {plan.name}
        </p>
        <p className="text-3xl font-bold">{plan.price}</p>
        <p className={`text-sm mt-1 ${isPopular ? "text-white/70" : "text-[#6b6b6b]"}`}>
          {plan.resumes} download{plan.resumes !== 1 ? "s" : ""}
        </p>
      </div>

      <ul className="flex flex-col gap-2 text-sm flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <Check className={`w-4 h-4 shrink-0 ${isPopular ? "text-white" : "text-[#1f5c3a]"}`} />
            <span className={isPopular ? "text-white/90" : "text-[#1a1a1a]"}>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        variant={isPopular ? "secondary" : "outline"}
        size="sm"
        className={isPopular ? "bg-white text-[#1f5c3a] hover:bg-white/90" : ""}
        onClick={handleChoose}
      >
        Choose {plan.name}
      </Button>

      {TEST_MODE && (
        <Button
          size="sm"
          variant="ghost"
          className={`text-xs gap-1 ${isPopular ? "text-white/70 hover:text-white hover:bg-white/10" : "text-[#6b6b6b]"}`}
          onClick={handleGrantTest}
          disabled={granting}
        >
          <FlaskConical className="w-3 h-3" />
          {granting ? "Granting…" : "Grant test plan (dev)"}
        </Button>
      )}
    </div>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/90 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-serif italic text-xl text-[#1f5c3a] font-bold">
            Neduresume
          </Link>
          <Link href="/dashboard" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-14">
          <h1 className="font-serif italic text-5xl text-[#1a1a1a] mb-4">Pricing</h1>
          <p className="text-[#6b6b6b]">All plans valid 1 year · No subscription · Pay once, use anytime</p>
          {TEST_MODE && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 inline-block">
              TEST MODE — "Grant test plan" buttons are visible
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          {PLANS.map((plan) => (
            <PlanCard key={plan.type} plan={plan} />
          ))}
        </div>

        <p className="text-center text-[#6b6b6b] text-sm">
          + LinkedIn Profile Rewrite add-on available for ₹500
        </p>

        <div className="mt-16 text-center">
          <p className="text-sm text-[#6b6b6b]">
            Questions?{" "}
            <a href="mailto:support@neduresume.com" className="text-[#1f5c3a] hover:underline">
              support@neduresume.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
