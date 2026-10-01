import { BuyButton } from "@/components/pricing/BuyButton";
import { PaymentsComingSoonButton } from "@/components/pricing/PaymentsComingSoonButton";

// The single switch between "Payments coming soon" (default, disabled, no
// handler) and the live Razorpay handoff. `enabled` must come from the
// server's isCheckoutAvailable() (lib/payments/config.ts) — never from the
// browser — and the payment APIs re-check the same config on every request.
export function PurchaseCta({ enabled, sku, withLinkedinAddon = false, planName, variant = "outline", className }: {
  enabled: boolean;
  sku: string;
  withLinkedinAddon?: boolean;
  planName: string;
  variant?: "outline" | "secondary";
  className?: string;
}) {
  return enabled
    ? <BuyButton sku={sku} withLinkedinAddon={withLinkedinAddon} planName={planName} variant={variant} className={className} />
    : <PaymentsComingSoonButton planName={planName} variant={variant} className={className} />;
}
