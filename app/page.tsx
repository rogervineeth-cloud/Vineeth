import Link from "next/link";
import { Upload, FileText, Download, Check } from "lucide-react";
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
  {
    q: "Will my resume pass ATS?",
    a: "Yes. We use single-column, ATS-optimized formatting. Every resume includes a live ATS match score.",
  },
  {
    q: "What if I don't have LinkedIn?",
    a: "Upload your LinkedIn PDF (Settings → Save as PDF on LinkedIn) or build from scratch using the manual form.",
  },
  {
    q: "Can I edit after generating?",
    a: "Yes, freely. Re-downloads of the same resume don't count as new credits.",
  },
  {
    q: "How long are resumes valid?",
    a: "One year from purchase date.",
  },
  {
    q: "Is there a free trial?",
    a: "Try it free — generate a resume and see the watermarked preview. Download requires a paid pack starting at ₹100.",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const { count } = await supabase
    .from("resumes")
    .select("*", { count: "exact", head: true });

  const resumeCount = count ?? 0;
  const trustBadge =
    resumeCount < 50
      ? "✦ Built for Indian job seekers"
      : `✦ ${Math.round(resumeCount / 10) * 10} resumes generated`;

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      {/* Header */}
      <header className="border-b border-stone-200/60 sticky top-0 bg-[#f7f3ea]/90 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-serif italic text-xl text-[#1f5c3a] font-bold">Neduresume</span>
          <Link href="/login" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
        <h1 className="font-serif italic text-5xl sm:text-6xl md:text-7xl text-[#1a1a1a] leading-tight mb-6">
          Your resume, tailored<br />for the role — in one minute.
        </h1>
        <p className="text-[#6b6b6b] text-lg sm:text-xl max-w-2xl mx-auto mb-10">
          Paste your LinkedIn. Paste the job description. Get an ATS-ready resume built in under a minute.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button size="lg" asChild className="w-full sm:w-auto text-base px-10">
            <Link href="/signup">Try free — no card needed</Link>
          </Button>
          <a
            href="#pricing"
            className="text-[#1f5c3a] text-sm font-medium hover:underline underline-offset-4"
          >
            See pricing ↓
          </a>
        </div>
        <div className="flex justify-center gap-2 mt-5 flex-wrap">
          <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ Optimized for LinkedIn</span>
          <span className="text-xs rounded-full border border-[#3d6b4f]/30 text-[#3d6b4f] px-3 py-1">✦ Optimized for Naukri</span>
        </div>
        <p className="text-xs text-[#1f5c3a] font-medium mt-3">{trustBadge}</p>
        <p className="text-xs text-[#6b6b6b] mt-1">Free preview forever · Download from ₹100</p>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-20 border-t border-stone-200/60">
        <h2 className="font-serif italic text-3xl text-[#1a1a1a] text-center mb-14">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#1f5c3a]/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-[#1f5c3a]" />
            </div>
            <h3 className="font-medium text-[#1a1a1a]">Upload your LinkedIn PDF</h3>
            <p className="text-sm text-[#6b6b6b]">
              Export from LinkedIn Settings → Save to PDF. We extract your experience automatically.
            </p>
          </div>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#1f5c3a]/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#1f5c3a]" />
            </div>
            <h3 className="font-medium text-[#1a1a1a]">Paste the job description</h3>
            <p className="text-sm text-[#6b6b6b]">
              Copy the full JD from LinkedIn Jobs, Naukri, or any company website.
            </p>
          </div>
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#1f5c3a]/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-[#1f5c3a]" />
            </div>
            <h3 className="font-medium text-[#1a1a1a]">Download your ATS resume</h3>
            <p className="text-sm text-[#6b6b6b]">
              See your ATS match score. Download a clean, single-column PDF — no watermark.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20 border-t border-stone-200/60">
        <h2 className="font-serif italic text-3xl text-[#1a1a1a] text-center mb-4">Pricing</h2>
        <p className="text-center text-[#6b6b6b] mb-14 text-sm">All plans valid 1 year · No subscription</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-xl border p-6 flex flex-col gap-4 ${
                plan.popular
                  ? "border-[#1f5c3a] bg-[#1f5c3a] text-white shadow-lg"
                  : plan.free
                  ? "border-stone-200 bg-stone-50"
                  : "border-stone-200 bg-white"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-black text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
                  Most popular
                </span>
              )}
              {plan.free && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-stone-200 text-stone-700 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
                  Always free
                </span>
              )}
              <div>
                <p className={`text-sm font-medium mb-1 ${plan.popular ? "text-white/80" : "text-[#6b6b6b]"}`}>
                  {plan.name}
                </p>
                <p className="text-3xl font-bold">{plan.price}</p>
                <p className={`text-sm mt-1 ${plan.popular ? "text-white/70" : "text-[#6b6b6b]"}`}>
                  {plan.resumes}
                </p>
              </div>
              <ul className="flex flex-col gap-2 text-sm flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className={`w-4 h-4 shrink-0 ${plan.popular ? "text-white" : "text-[#1f5c3a]"}`} />
                    <span className={plan.popular ? "text-white/90" : "text-[#1a1a1a]"}>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={plan.popular ? "secondary" : "outline"}
                size="sm"
                className={plan.popular ? "bg-white text-[#1f5c3a] hover:bg-white/90" : ""}
              >
                <Link href={plan.free ? "/signup" : `/signup?plan=${plan.name.toLowerCase().replace(/ /g, "_")}`}>{plan.free ? "Start free" : "Get started"}</Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-[#6b6b6b] text-sm mt-8">
          + LinkedIn Profile Rewrite add-on available for ₹500
        </p>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-20 border-t border-stone-200/60">
        <h2 className="font-serif italic text-3xl text-[#1a1a1a] text-center mb-14">FAQ</h2>
        <div className="flex flex-col gap-2">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group border border-stone-200 rounded-lg bg-white overflow-hidden"
            >
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
        © 2026 Neduresume · Made in Kerala
      </footer>
    </div>
  );
}
