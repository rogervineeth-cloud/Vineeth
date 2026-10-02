import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BETA_CREDITS, FREE_BETA_LABEL } from "@/lib/plan-config";

// The free offer, as shown on the landing page and /pricing. What it promises
// is what the server enforces (migration 018, lib/beta.ts): ONE free AI
// resume preview per verified account, viewable but not downloadable; every
// PDF download and every further resume needs a paid credit.
export const FREE_BETA_FEATURES = [
  `${BETA_CREDITS} free AI-tailored resume preview per verified account`,
  "View your preview online — PDF download requires a paid credit",
  "1 free ATS review of any resume",
  "No card required",
] as const;

export function FreeBetaCard({ cta }: { cta: { href: string; label: string } }) {
  return (
    <div className="max-w-md mx-auto rounded-2xl border border-[#1f5c3a] bg-white p-6 shadow-sm flex flex-col gap-4">
      <p className="self-start inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1f5c3a] bg-[#1f5c3a]/10 rounded-full px-2.5 py-0.5">
        <Sparkles className="w-3 h-3" aria-hidden="true" />
        Free preview
      </p>
      <h3 className="text-2xl font-semibold text-[#1a1a1a]">{FREE_BETA_LABEL}</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {FREE_BETA_FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="w-4 h-4 shrink-0 mt-0.5 text-[#1f5c3a]" aria-hidden="true" />
            <span className="text-[#1a1a1a]">{f}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[#6b6b6b]">
        More resumes and every PDF download require paid credits. Payments are coming soon.
      </p>
      <Button asChild className="bg-[#1f5c3a] hover:bg-[#174d30]">
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
    </div>
  );
}
