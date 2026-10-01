"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  runCheckout, loadRazorpayCheckoutScript,
  type CheckoutState, type RazorpayOptions, type RazorpayInstance,
} from "@/lib/payments/checkout-client";

// Rendered only when the server says checkout is available
// (lib/payments/config.ts); otherwise pages render PaymentsComingSoonButton.
// Razorpay's script loads only after our server has created the order.
export function BuyButton({ sku, withLinkedinAddon = false, planName, variant = "outline", className }: {
  sku: string;
  withLinkedinAddon?: boolean;
  planName: string;
  variant?: "outline" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<CheckoutState | null>(null);
  // One checkout attempt; reused only to retry the same purchase after a
  // retryable failure, so a retry cannot create a second order.
  const attempt = useRef<{ id: string; key: string } | null>(null);
  const busy = state?.kind === "starting" || state?.kind === "open" || state?.kind === "verifying";

  async function buy() {
    if (busy) return;
    const key = `${sku}|${withLinkedinAddon}`;
    if (attempt.current?.key !== key) attempt.current = { id: crypto.randomUUID(), key };
    const result = await runCheckout({ sku, withLinkedinAddon }, attempt.current.id, {
      post: async (url, body) => {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json().catch(() => ({})) };
      },
      loadCheckoutScript: loadRazorpayCheckoutScript,
      createRazorpay: (options: RazorpayOptions) => {
        const Ctor = (window as unknown as { Razorpay: new (o: RazorpayOptions) => RazorpayInstance }).Razorpay;
        return new Ctor(options);
      },
    }, setState);

    if (!(result.kind === "failed" && result.retryable)) attempt.current = null;
    if (result.kind === "signin") { router.push("/login?returnTo=/pricing"); return; }
    if (result.kind === "success") {
      toast.success(`${planName} added to your account.`);
      router.push("/dashboard");
    } else if (result.kind === "pending") toast.info(result.message, { duration: 8000 });
    else if (result.kind === "failed") toast.error(result.message, { duration: 8000 });
  }

  const label = state?.kind === "starting" ? "Starting checkout…"
    : state?.kind === "open" ? "Complete payment in the window…"
    : state?.kind === "verifying" ? "Confirming payment…"
    : `Buy ${planName}`;

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="sm" variant={variant} className={className} onClick={buy} disabled={busy} aria-busy={busy} data-payment-cta="enabled">
        {label}
      </Button>
      <p role="status" aria-live="polite" className="text-xs min-h-[1rem] opacity-80">
        {state && (state.kind === "cancelled" || state.kind === "failed" || state.kind === "pending") ? state.message : ""}
      </p>
    </div>
  );
}
