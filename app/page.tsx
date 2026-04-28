import Link from "next/link";
import { FileText, Check, Sparkles, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const plans = [
  {
    name: "Free Preview",
    price: "₹0",
    resumes: "Unlimited previews",
    popular: false,
    free: true,
    features: ["Generate resumes", "Watermarked preview", "ATS score & keywords", "No download"],
  },
  {
    name: "Starter",
    price: "₹100",
    resumes: "1 download",
    popular: false,
    free: false,
    features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
    name: "Fresher",
    price: "₹299",
    resumes: "5 downloads",
    popular: true,
    free: false,
    features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
  {
    name: "Job Hunter",
    price: "₹599",
    resumes: "12 downloads",
    popular: false,
    free: false,
    features: ["ATS-optimised PDF", "Live keyword score", "Unlimited edits", "1-year validity"],
  },
];

const faqs = [
  { q: "Will my resume pass ATS?", a: "Yes. We use single-column, ATS-optimized formatting. Every resume includes a live ATS match score." },
  { q: "What if I don't have LinkedIn?", a: "Upload your LinkedIn PDF (Settings → Save as PDF on LinkedIn) or build from scratch using the manual form." },
  { q: "Can I edit after generating?", a: "Yes, freely. Re-downloads of the same resume don't count as new credits." },
  { q: "How long are resumes valid?", a: "One year from purchase date." },
  { q: "Is there a free trial?", a: "Try it free — generate a resume and see the watermarked preview. Download requires a paid pack starting at ₹100." },
];

export default async function Home() {
  const supabase = await createClient();
  const { count } = await supabase.from("resumes").select("*", { count: "exact", head: true });
  const resumeCount = count ?? 0;
  const resumeCountDisplay = resumeCount < 50 ? "500+" : `${Math.round(resumeCount / 10) * 10}+`;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      {/* Header */}
      <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/95 backdrop-blur-sm z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-serif italic text-xl text-[#1f5c3a] font-bold">Neduresume</span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-[#1f5c3a]/70 tracking-wide">
              powered by AI
            </span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#pricing" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors hidden sm:block">Pricing</a>
            <Link href="/login" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">Sign in</Link>
            <Button size="sm" asChild className="text-sm bg-[#1f5c3a] hover:bg-[#174d30]">
              <Link href="/signup">Get started free →</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left column */}
          <div>
            <div className="inline-flex items-center gap-2 bg-[#1f5c3a]/10 border border-[#1f5c3a]/25 text-[#1f5c3a] text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <Sparkles className="w-3 h-3" />
              Neduresume AI — The AI Resume Maker
            </div>
            <h1 className="font-serif italic text-4xl sm:text-5xl lg:text-[3.25rem] text-[#1a1a1a] leading-[1.15] mb-5">
              Your AI resume, tailored<br />to your dream job —<br />
              <span className="text-[#1f5c3a]">built to get you hired.</span>
            </h1>
            <p className="text-[#6b6b6b] text-base sm:text-lg max-w-lg mb-8 leading-relaxed">
              Paste a job description. Neduresume AI reads it, matches your profile, and crafts a resume that gets you shortlisted at the world's leading firms — ATS-ready, every time.
            </p>
            {/* Two-path CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Button size="lg" asChild className="text-base px-8 bg-[#1f5c3a] hover:bg-[#174d30]">
                <Link href="/signup?path=experienced">I&apos;m experienced →</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="text-base px-8 border-[#1f5c3a] text-[#1f5c3a] hover:bg-[#1f5c3a]/5">
                <Link href="/signup?path=fresher">I&apos;m a fresher →</Link>
              </Button>
            </div>
            {/* Trust strip */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ ATS-optimised</span>
              <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ LinkedIn</span>
              <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ Naukri</span>
              <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ Monster</span>
              <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ Indeed</span>
              <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ Top MNCs</span>
            </div>
            <p className="text-xs text-[#6b6b6b]">{resumeCountDisplay} resumes generated · Free preview forever · Download from ₹100</p>
          </div>

          {/* Right column — resume mockup */}
          <div className="hidden lg:flex justify-center items-center">
            <div className="relative">
              <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-2xl bg-[#1f5c3a]/15" />
              <div className="relative bg-white rounded-2xl shadow-xl border border-stone-200 p-6 w-[320px]">
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
                  ✦ Generated by Neduresume AI in 12s
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
              <p className="font-semibold text-sm text-[#1a1a1a]">AI writes your bullets</p>
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
              <p className="text-xs text-[#6b6b6b] mt-0.5">Single-column, clean formatting that passes every ATS scanner.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16 border-t border-stone-200/60">
        <h2 className="font-serif italic text-3xl text-[#1a1a1a] text-center mb-2">Simple pricing</h2>
        <p className="text-center text-[#6b6b6b] mb-10 text-sm">All plans valid 1 year · No subscription · Pay once, use anytime</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((plan) => (
            <div key={plan.name} className={`relative rounded-xl border p-5 flex flex-col gap-4 ${plan.popular ? "border-[#1f5c3a] bg-[#1f5c3a] text-white shadow-lg" : plan.free ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"}`}>
              {plan.popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Most popular</span>}
              {plan.free && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-stone-200 text-stone-700 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">Always free</span>}
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
              <Button asChild variant={plan.popular ? "secondary" : "outline"} size="sm" className={plan.popular ? "bg-white text-[#1f5c3a] hover:bg-white/90" : ""}>
                <Link href={plan.free ? "/signup" : `/signup?plan=${plan.name.toLowerCase().replace(/ /g, "_")}`}>{plan.free ? "Start free" : "Get started"}</Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-[#6b6b6b] text-sm mt-6">+ LinkedIn Profile Rewrite add-on available for ₹500</p>
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
      <footer className="border-t border-stone-200/60 py-8 text-center text-sm text-[#6b6b6b]">
        © 2026 Neduresume AI · Made in India
      </footer>
    </div>
  );
}
