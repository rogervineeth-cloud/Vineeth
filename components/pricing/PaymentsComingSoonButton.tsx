import { Button } from "@/components/ui/button";
import { PAYMENTS_COMING_SOON } from "@/lib/pricing-display";

// The only purchase control the pricing UI renders while payments are not
// integrated: a disabled button with no handler and no link. It cannot start
// a checkout, call an API, or change an entitlement.
export function PaymentsComingSoonButton({ planName, className, variant = "outline" }: {
  planName: string;
  className?: string;
  variant?: "outline" | "secondary";
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      disabled
      aria-disabled="true"
      aria-label={`${planName}: ${PAYMENTS_COMING_SOON}`}
      data-payment-cta="disabled"
    >
      {PAYMENTS_COMING_SOON}
    </Button>
  );
}
