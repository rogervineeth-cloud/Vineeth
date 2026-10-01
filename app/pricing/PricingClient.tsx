"use client";
import Link from "next/link";
import { Check, Briefcase, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS } from "@/lib/plan-config";
import type { Plan } from "@/lib/plan-config";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import { planFeatures, LINKEDIN_ADDON as LINKEDIN } from "@/lib/pricing-display";
import { PurchaseCta } from "@/components/pricing/PurchaseCta";
import { FreeBetaCard } from "@/components/beta/FreeBetaCard";

// Restored paid pricing (as before commit 7709d56). PAYMENTS ARE NOT LIVE:
// the "Choose <plan>" and "Buy LinkedIn Rewrite" buttons are replaced by a
// disabled "Payments coming soon" (no handler, no request). Removed with them:
// the /api/checkout/validate call and checkout_start tracking, and the
// TEST_MODE "Grant test plan" button (it created entitlements).

function PlanCard({
  plan,
  withAddon,
  onToggleAddon,
  showAddonToggle,
  checkoutEnabled,
}: {
  plan: Plan;
  withAddon: boolean;
  onToggleAddon: (next: boolean) => void;
  showAddonToggle: boolean;
  checkoutEnabled: boolean;
}) {
  // Displayed price only (plan + optional LinkedIn bundle); nothing is charged.
  const total = plan.priceInr + (withAddon ? LINKEDIN.bundlePriceInr : 0);
  const isPopular = plan.badge === "Most popular";

  return (
    <div
      id={plan.type}
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

      <PurchaseCta
        enabled={checkoutEnabled}
        sku={plan.type}
        withLinkedinAddon={withAddon}
        planName={withAddon ? `${plan.name} + LinkedIn Rewrite` : plan.name}
        variant={isPopular ? "secondary" : "outline"}
        className={isPopular ? "bg-white text-[#1f5c3a] hover:bg-white/90" : ""}
      />
    </div>
  );
}

function LinkedinAddonCard({ checkoutEnabled }: { checkoutEnabled: boolean }) {
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
        <PurchaseCta enabled={checkoutEnabled} sku="linkedin_rewrite" planName={LINKEDIN.name} />
      </div>
    </div>
  );
}

// The CTA has to reflect who is looking at it. A signed-in user was being
// shown "Sign up free →", which is nonsense for someone already holding an
// account.
function FreeReviewBanner({ signedIn }: { signedIn: boolean }) {
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
          {signedIn ? "Run free review →" : "Sign up free →"}
        </Link>
      </div>
    </div>
  );
}

// checkoutEnabled comes from the server (lib/payments/config.ts
// isCheckoutAvailable); false by default, which keeps every purchase control
// a disabled "Payments coming soon".
export default function PricingClient({ pricingV2, checkoutEnabled = false }: { pricingV2: boolean; checkoutEnabled?: boolean }) {
  const [withAddon, setWithAddon] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const router = useRouter();

  useEffect(() => {
    track("pricing_view");
  }, []);

  // Pricing sits outside the (app) route group, so it has its own header and
  // no session awareness. Without this it showed signed-out UI — "Sign up
  // free" and a nav missing Profile — to users who were already logged in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      if (!cancelled) setSignedIn(!!user);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/90 backdrop-blur-sm z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-serif italic text-xl text-[#1f5c3a] font-bold">
            Neduresume
          </Link>
          {/* Match the nav on every other page for signed-in users instead of
              offering a bare "Dashboard" link and nothing else. */}
          <nav className="flex items-center gap-5">
            <Link href="/dashboard" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
              Dashboard
            </Link>
            {signedIn ? (
              <>
                <Link href="/profile" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    await createClient().auth.signOut();
                    router.push("/");
                  }}
                  className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/login" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-serif italic text-5xl text-[#1a1a1a] mb-4">Pricing</h1>
          <p className="text-[#6b6b6b]">All plans valid 1 year · No subscription · Pay once, use anytime</p>
        </div>

        {/* Available now, separate from the paid plans: the Free Beta. */}
        <div className="mb-12">
          <FreeBetaCard paidPlansAvailable={checkoutEnabled} cta={signedIn ? { href: "/create", label: "Use your free generations →" } : { href: "/signup", label: "Start your free beta →" }} />
        </div>


        {pricingV2 && (
          <div className="mb-8">
            <FreeReviewBanner signedIn={signedIn} />
          </div>
        )}

        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-[#6b6b6b] mb-1">Paid plans</h2>
        {checkoutEnabled ? (
          <p className="text-center text-[#6b6b6b] text-sm mb-8">One-time payment, securely processed by Razorpay. Credits are added to your account once the payment is confirmed.</p>
        ) : (
          <p className="text-center text-[#6b6b6b] text-sm mb-8">
            Payments aren&apos;t live yet — these plans can&apos;t be bought today. During the beta, use your 3 free resume generations.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.type}
              plan={plan}
              withAddon={pricingV2 && withAddon}
              onToggleAddon={setWithAddon}
              showAddonToggle={pricingV2}
              checkoutEnabled={checkoutEnabled}
            />
          ))}
        </div>

        <LinkedinAddonCard checkoutEnabled={checkoutEnabled} />

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
