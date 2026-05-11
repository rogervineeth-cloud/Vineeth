"use client";
import Link from "next/link";
import { Check, FlaskConical, Briefcase, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PLANS, ADDONS } from "@/lib/plan-config";
import type { Plan } from "@/lib/plan-config";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "true";
const LINKEDIN = ADDONS.find((a) => a.id === "linkedin_rewrite")!;

function planFeatures(plan: Plan): string[] {
  const n = plan.aiGenerations;
  return [
    `${n} AI-tailored resume${n !== 1 ? "s" : ""}`,
    "Unlimited PDF downloads",
    "Live ATS keyword score",
    "1-year validity",
  ];
}

function PlanCard({
  plan,
  withAddon,
  onToggleAddon,
  showAddonToggle,
}: {
  plan: Plan;
  withAddon: boolean;
  onToggleAddon: (next: boolean) => void;
  showAddonToggle: boolean;
}) {
  const [granting, setGranting] = useState(false);
  const router = useRouter();

  const total = plan.priceInr + (withAddon ? LINKEDIN.bundlePriceInr : 0);

  async function handleChoose() {
    track("plan_click", { plan: plan.type, addon_linkedin: withAddon, total_inr: total });
    track("checkout_start", { plan: plan.type, addon_linkedin: withAddon, total_inr: total });

    // Server-side amount validation. Catches client tampering even though
    // payments are deferred — when Razorpay lands, this is where the order
    // intent is created.
    const validate = await fetch("/api/checkout/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planType: plan.type, withAddon, totalInr: total }),
    });
    if (!validate.ok) {
      const err = await validate.json().catch(() => ({}));
      toast.error(err.error ?? "Could not start checkout. Please refresh and retry.");
      return;
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      toast.info(
        `Payment integration coming soon! Your selection: ${plan.name}${withAddon ? " + LinkedIn Rewrite" : ""} — ₹${total}.`,
        {
          duration: 6000,
          action: { label: "Go to Dashboard", onClick: () => router.push("/dashboard") },
        }
      );
    } else {
      const params = new URLSearchParams({ plan: plan.type });
      if (withAddon) params.set("addon", "linkedin_rewrite");
      router.push(`/signup?${params.toString()}`);
    }
  }

  async function handleGrantTest() {
    setGranting(true);
    try {
      const res = await fetch("/api/dev/grant-test-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_type: plan.type, addon: withAddon ? "linkedin_rewrite" : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Grant failed.");
        return;
      }
      toast.success(
        `${plan.name} test plan granted (${data.plan.resumes_allotted} credits).` +
          (withAddon ? " LinkedIn Rewrite entitlement granted." : "")
      );
    } catch {
      toast.error("Grant failed.");
    } finally {
      setGranting(false);
    }
  }

  const isPopular = plan.badge === "Most popular";

  return (
    <div
      className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
        isPopular
          ? "border-[#1f5c3a] bg-[#1f5c3a] text-white shadow-lg"
          : "border-stone-200 bg-white"
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
          {plan.badge}
        </span>
      )}

      <div>
        <p className={`text-sm font-medium mb-1 ${isPopular ? "text-white/80" : "text-[#6b6b6b]"}`}>
          {plan.name}
        </p>
        <p className="text-3xl font-bold">₹{total}</p>
        <p className={`text-sm mt-1 ${isPopular ? "text-white/70" : "text-[#6b6b6b]"}`}>
          {plan.aiGenerations} AI-tailored resume{plan.aiGenerations !== 1 ? "s" : ""}
          {withAddon ? " · incl. LinkedIn Rewrite" : ""}
        </p>
      </div>

      <ul className="flex flex-col gap-2 text-sm flex-1">
        {planFeatures(plan).map((f) => (
          <li key={f} className="flex items-center gap-2">
            <Check className={`w-4 h-4 shrink-0 ${isPopular ? "text-white" : "text-[#1f5c3a]"}`} />
            <span className={isPopular ? "text-white/90" : "text-[#1a1a1a]"}>{f}</span>
          </li>
        ))}
      </ul>

      {showAddonToggle && (
        <label
          className={`flex items-center gap-2 text-xs cursor-pointer rounded-md border px-2 py-1.5 ${
            isPopular
              ? "border-white/30 bg-white/10 text-white"
              : "border-stone-200 bg-stone-50 text-[#1a1a1a]"
          }`}
        >
          <input
            type="checkbox"
            className="accent-[#1f5c3a]"
            checked={withAddon}
            onChange={(e) => {
              onToggleAddon(e.target.checked);
              track("addon_toggle", {
                addon: "linkedin_rewrite",
                on: e.target.checked,
                plan: plan.type,
              });
            }}
          />
          <span>
            Add LinkedIn Rewrite — ₹{LINKEDIN.bundlePriceInr}{" "}
            <span className={isPopular ? "text-white/70" : "text-[#6b6b6b]"}>
              (save ₹{LINKEDIN.priceInr - LINKEDIN.bundlePriceInr})
            </span>
          </span>
        </label>
      )}

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

function LinkedinAddonCard() {
  const router = useRouter();

  async function handleBuy() {
    track("plan_click", { plan: "linkedin_only", addon_linkedin: true, total_inr: LINKEDIN.priceInr });
    track("checkout_start", { plan: "linkedin_only", addon_linkedin: true, total_inr: LINKEDIN.priceInr });

    const validate = await fetch("/api/checkout/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planType: null, withAddon: true, totalInr: LINKEDIN.priceInr }),
    });
    if (!validate.ok) {
      toast.error("Could not start checkout. Please refresh and retry.");
      return;
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      toast.info(
        `Payment integration coming soon! Your selection: LinkedIn Rewrite — ₹${LINKEDIN.priceInr}.`,
        {
          duration: 6000,
          action: { label: "Go to Dashboard", onClick: () => router.push("/dashboard") },
        }
      );
    } else {
      router.push(`/signup?addon=linkedin_rewrite`);
    }
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-6 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
      <div className="w-12 h-12 rounded-lg bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
        <Briefcase className="w-6 h-6 text-[#0A66C2]" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-[#1a1a1a]">{LINKEDIN.name}</p>
        <p className="text-xs text-[#6b6b6b] mt-1">
          AI-rewritten Headline, About, and 3 Experience sections — paste your current LinkedIn URL or text.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-2xl font-bold text-[#1a1a1a]">₹{LINKEDIN.priceInr}</p>
        <Button variant="outline" size="sm" onClick={handleBuy}>
          Buy LinkedIn Rewrite
        </Button>
      </div>
    </div>
  );
}

function FreeReviewBanner() {
  return (
    <div className="rounded-xl border-2 border-dashed border-[#1f5c3a]/40 bg-gradient-to-r from-[#1f5c3a]/8 via-[#1f5c3a]/5 to-[#1f5c3a]/8 px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
        <div className="flex-1">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#1f5c3a] bg-[#1f5c3a]/10 rounded-full px-2 py-0.5 mb-2">
            <Sparkles className="w-3 h-3" />
            Free ATS preview
          </p>
          <p className="text-base font-semibold text-[#1a1a1a]">
            Score your resume against any JD — free, in 30 seconds.
          </p>
          <p className="text-sm text-[#1a1a1a]/80 mt-1">
            1 free ATS preview per account · Keyword gap, missing skills, structure check
            <span className="text-[#1f5c3a] font-medium"> · No card required</span>
          </p>
        </div>
        <Link
          href="/free-review"
          onClick={() => track("free_review_start", { from: "pricing_banner" })}
          className="inline-flex items-center justify-center gap-1.5 bg-[#1f5c3a] hover:bg-[#174d30] text-white font-medium text-sm rounded-md px-5 py-2.5 transition-colors whitespace-nowrap"
        >
          Sign up free →
        </Link>
      </div>
    </div>
  );
}

export default function PricingClient({ pricingV2 }: { pricingV2: boolean }) {
  const [withAddon, setWithAddon] = useState(false);

  useEffect(() => {
    track("pricing_view");
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/90 backdrop-blur-sm z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-serif italic text-xl text-[#1f5c3a] font-bold">
            Neduresume
          </Link>
          <Link href="/dashboard" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-serif italic text-5xl text-[#1a1a1a] mb-4">Pricing</h1>
          <p className="text-[#6b6b6b]">All plans valid 1 year · No subscription · Pay once, use anytime</p>
          {TEST_MODE && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 inline-block">
              TEST MODE — &quot;Grant test plan&quot; buttons are visible
            </p>
          )}
        </div>

        {pricingV2 && (
          <div className="mb-8">
            <FreeReviewBanner />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.type}
              plan={plan}
              withAddon={pricingV2 && withAddon}
              onToggleAddon={setWithAddon}
              showAddonToggle={pricingV2}
            />
          ))}
        </div>

        <LinkedinAddonCard />

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
