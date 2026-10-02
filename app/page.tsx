import { FileText, Check, Sparkles, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { FreeBetaCard } from "@/components/beta/FreeBetaCard";
import { PaymentsComingSoonButton } from "@/components/pricing/PaymentsComingSoonButton";
import { PAID_TIERS, LINKEDIN_ADDON } from "@/lib/pricing-display";

const faqs = [
  { q: "Will my resume pass ATS?", a: "Yes. We use single-column, ATS-optimised formatting. Every resume includes a live ATS match score before you download." },
  { q: "What if I don't have LinkedIn?", a: "No problem. You can build from scratch using our guided manual form, or upload an existing resume to get started." },
  { q: "Can I edit after generating?", a: "Yes, freely. Re-downloads of the same resume don't count as new credits." },
  { q: "What is free?", a: "One AI-tailored resume preview per verified account — you can view it online — plus one free ATS review. PDF download requires a paid credit." },
  { q: "What needs a paid credit?", a: "Every PDF download and every AI resume after your free preview, including regenerations. A resume you've paid for can be downloaded again any time at no extra cost. Payments are coming soon." },
  { q: "How long are credits valid?", a: "One year from when they're added to your account." },
  { q: "What is the LinkedIn Profile Rewrite?", a: "An AI-rewritten LinkedIn Headline, About section, and top Experience entries. It isn't available yet." },
];

export default async function Home() {
  const supabase = await createClient();
  const { count } = await supabase.from("resumes").select("*", { count: "exact", head: true });
  const resumeCount = count ?? 0;
  const showResumeCount = resumeCount >= 50;
  const resumeCountDisplay = showResumeCount ? `${Math.round(resumeCount / 10) * 10}+` : null;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <LandingHeader />

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-10 sm:pt-14 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left column */}
          <div className="animate-fade-in-up">
            <div className="inline-flex items-center gap-2 bg-[#1f5c3a]/10 border border-[#1f5c3a]/25 text-[#1f5c3a] text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <Sparkles className="w-3 h-3" />
              The AI Resume Maker, made for India
            </div>
            {/* Mobile headline (shorter, fewer line breaks) */}
            <h1 className="font-serif text-[1.75rem] text-[#1a1a1a] leading-[1.2] mb-5 sm:hidden">
              Your AI resume,<br />tailored to <span className="text-[#1f5c3a]">land your dream job.</span>
            </h1>
            {/* Desktop / tablet headline */}
            <h1 className="hidden sm:block font-serif italic text-4xl sm:text-5xl lg:text-[3.25rem] text-[#1a1a1a] leading-[1.15] mb-5">
              Your AI resume, tailored<br />to your dream job —<br /><span className="text-[#1f5c3a]">built to get you hired.</span>
            </h1>
            <p className="text-[#6b6b6b] text-base sm:text-lg max-w-lg mb-8 leading-relaxed">
              Paste a job description. Neduresume reads it, matches your profile, and crafts a resume tailored to the role you&apos;re applying for — ATS-optimised on every download.
            </p>
            {/* Two-path CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Button size="lg" asChild className="text-base px-8 bg-[#1f5c3a] hover:bg-[#174d30] transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#1f5c3a]/20">
                <Link href="/signup?path=experienced">I&apos;m experienced →</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="text-base px-8 border-[#1f5c3a] text-[#1f5c3a] hover:bg-[#1f5c3a]/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-[#1f5c3a]/10">
                <Link href="/signup?path=fresher">I&apos;m a fresher →</Link>
              </Button>
            </div>
            {/* Trust strip */}
            <div className="relative flex overflow-hidden group mb-4 w-full sm:max-w-md py-1" style={{ maskImage: 'linear-gradient(to right, black 80%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
              <div className="flex shrink-0 gap-2 animate-marquee group-hover:[animation-play-state:paused]">
                {[...["ATS-optimised", "LinkedIn", "Naukri", "Monster", "Indeed", "Top MNCs"], ...["ATS-optimised", "LinkedIn", "Naukri", "Monster", "Indeed", "Top MNCs"]].map((label, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1 whitespace-nowrap bg-[#1f5c3a]/5 transition-colors hover:bg-[#1f5c3a]/10">
                    <Sparkles className="w-3 h-3" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-[#6b6b6b]">
              {showResumeCount ? `${resumeCountDisplay} resumes generated · ` : ""}1 free AI resume preview · PDF download requires a paid credit
            </p>
          </div>

          {/* Right column — resume mockup */}
          <div className="hidden lg:flex justify-center items-center">
            <div className="relative animate-float">
              <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-2xl bg-[#1f5c3a]/15" />
              <div className="relative bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl shadow-[#1f5c3a]/10 border border-stone-200/60 p-6 w-[320px]">
                <div className="bg-[#1f5c3a] rounded-lg px-4 py-3 mb-4">
                  <div className="h-3 w-28 bg-white/90 rounded mb-1.5" />
                  <div className="h-2 w-20 bg-white/60 rounded mb-1" />
                  <div className="h-1.5 w-36 bg-white/40 rounded" />
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold text-[#1f5c3a] uppercase tracking-wide">ATS Match</span>
                  <span className="text-xs font-bold text-white bg-[#1f5c3a] px-2 py-0.5 rounded-full">94%</span>
                </div>
                {[{ w: "w-full" }, { w: "w-5/6" }, { w: "w-4/5" }].map((l, i) => (
                  <div key={i} className={`h-2 ${l.w} bg-stone-200 rounded mb-2`} />
                ))}
                <div className="border-t border-stone-100 my-3" />
                <div className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide mb-2">Experience</div>
                {[{ w: "w-full" }, { w: "w-5/6" }, { w: "w-3/4" }, { w: "w-full" }, { w: "w-4/5" }].map((l, i) => (
                  <div key={i} className={`h-1.5 ${l.w} bg-stone-200 rounded mb-1.5`} />
                ))}
                <div className="border-t border-stone-100 my-3" />
                <div className="text-[10px] font-semibold text-[#6b6b6b] uppercase tracking-wide mb-2">Skills</div>
                <div className="flex flex-wrap gap-1">
                  {["React", "Node.js", "TypeScript", "AWS"].map((s) => (
                    <span key={s} className="text-[9px] bg-[#1f5c3a]/10 text-[#1f5c3a] px-2 py-0.5 rounded-full border border-[#1f5c3a]/20">{s}</span>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-[10px] text-[#6b6b6b]">
                  <Sparkles className="w-3 h-3 text-[#1f5c3a]" />
                  Generated by Neduresume in 12s
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12 pt-10 border-t border-stone-200/60">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1f5c3a]/10 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-[#1f5c3a]" />
            </div>
            <div>
              <p className="font-semibold text-sm text-[#1a1a1a]">Bullets written for you</p>
              <p className="text-xs text-[#6b6b6b] mt-0.5">Tailored to the job description, not generic templates.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1f5c3a]/10 flex items-center justify-center shrink-0">
              <Target className="w-4 h-4 text-[#1f5c3a]" />
            </div>
            <div>
              <p className="font-semibold text-sm text-[#1a1a1a]">Matched to the JD</p>
              <p className="text-xs text-[#6b6b6b] mt-0.5">Keywords, skills, and tone aligned to what the recruiter wants.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1f5c3a]/10 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-[#1f5c3a]" />
            </div>
            <div>
              <p className="font-semibold text-sm text-[#1a1a1a]">ATS-ready PDF</p>
              <p className="text-xs text-[#6b6b6b] mt-0.5">Single-column, clean formatting designed to parse cleanly.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16 border-t border-stone-200/60">
        <h2 className="font-serif italic text-3xl text-[#1a1a1a] text-center mb-2">Simple pricing</h2>
        <p className="text-center text-[#6b6b6b] mb-8 text-sm">All plans valid 1 year · No subscription · Pay once, use anytime</p>

        <div className="max-w-3xl mx-auto mb-8 rounded-xl border-2 border-dashed border-[#1f5c3a]/40 bg-[#1f5c3a]/5 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
            <div className="flex-1">
              <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#1f5c3a] bg-[#1f5c3a]/10 rounded-full px-2 py-0.5 mb-2">
                <Sparkles className="w-3 h-3" />
                Free ATS preview
              </p>
              <p className="text-base font-semibold text-[#1a1a1a]">Score your resume against any JD — free.</p>
              <p className="text-sm text-[#1a1a1a]/80 mt-1">
                1 free preview per account · Keyword gap, missing skills, structure check
                <span className="text-[#1f5c3a] font-medium"> · No card required</span>
              </p>
            </div>
            <Button asChild size="sm" className="bg-[#1f5c3a] hover:bg-[#174d30] whitespace-nowrap">
              <Link href="/signup?next=/free-review">Sign up free →</Link>
            </Button>
          </div>
        </div>

        {/* Available now: 1 free AI resume preview per account (migration 018). */}
        <div className="mb-12">
          <FreeBetaCard cta={{ href: "/signup", label: "Get your free preview →" }} />
        </div>

        {/* Paid plans, restored as they were before 7709d56. Payments are not
            integrated yet: every card's button is a disabled "Payments coming
            soon" (lib/pricing-display.ts). */}
        <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-[#6b6b6b] mb-1">Paid plans</h3>
        <p className="text-center text-[#6b6b6b] text-sm mb-8">Payments aren&apos;t live yet — paid credits can&apos;t be bought today.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PAID_TIERS.map((plan, idx) => (
            <div
              key={plan.slug}
              id={plan.slug}
              className={`relative rounded-xl border p-5 flex flex-col gap-4 ${plan.popular ? "border-[#1f5c3a] bg-[#1f5c3a] text-white shadow-lg" : "border-stone-200 bg-white"} ${idx === 0 ? "mt-3 sm:mt-0" : ""}`}
            >
              {plan.popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Most popular</span>}
              <div>
                <p className={`text-sm font-medium mb-1 ${plan.popular ? "text-white/80" : "text-[#6b6b6b]"}`}>{plan.name}</p>
                <p className="text-3xl font-bold">{plan.price}</p>
                <p className={`text-sm mt-1 ${plan.popular ? "text-white/70" : "text-[#6b6b6b]"}`}>{plan.resumes}</p>
              </div>
              <ul className="flex flex-col gap-2 text-sm flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className={`w-4 h-4 shrink-0 ${plan.popular ? "text-white" : "text-[#1f5c3a]"}`} />
                    <span className={plan.popular ? "text-white/90" : "text-[#1a1a1a]"}>{f}</span>
                  </li>
                ))}
              </ul>
              <PaymentsComingSoonButton
                planName={plan.name}
                variant={plan.popular ? "secondary" : "outline"}
                className={plan.popular ? "bg-white text-[#1f5c3a] hover:bg-white/90" : ""}
              />
            </div>
          ))}
        </div>
        <p className="text-center text-[#6b6b6b] text-sm mt-6">+ LinkedIn Profile Rewrite add-on — ₹{LINKEDIN_ADDON.priceInr} standalone, ₹{LINKEDIN_ADDON.bundlePriceInr} bundled with any plan</p>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-14 border-t border-stone-200/60">
        <h2 className="font-serif italic text-3xl text-[#1a1a1a] text-center mb-10">FAQ</h2>
        <div className="flex flex-col gap-2">
          {faqs.map((faq) => (
            <details key={faq.q} className="group border border-stone-200 rounded-lg bg-white overflow-hidden">
              <summary className="px-5 py-4 cursor-pointer font-medium text-[#1a1a1a] list-none flex items-center justify-between gap-4 hover:bg-stone-50 transition-colors">
                {faq.q}
                <span className="text-[#6b6b6b] shrink-0 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
              </summary>
              <div className="px-5 pb-4 text-sm text-[#6b6b6b] leading-relaxed">{faq.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200/60 py-8 px-6 text-center text-sm text-[#6b6b6b]">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6">
          <span>© 2026 Neduresume · Made in India</span>
          <span className="hidden sm:inline text-stone-300">|</span>
          <a href="mailto:rogervineeth@gmail.com" className="hover:text-[#1a1a1a] transition-colors">Contact</a>
        </div>
      </footer>
    </div>
  );
}
