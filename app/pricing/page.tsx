import { isPricingV2Enabled } from "@/lib/feature-flags";
import { isCheckoutAvailable } from "@/lib/payments/config";
import PricingClient from "./PricingClient";

// The paid pricing page as it was before commit 7709d56, restored. Payments
// are not integrated: PricingClient's purchase buttons are disabled
// ("Payments coming soon") and make no requests. The Free Beta offer (3
// generations per account) is shown first, as what is available now.
export default function PricingPage() {
  // Buy buttons only when the server's payment config allows it (off by default).
  return <PricingClient pricingV2={isPricingV2Enabled()} checkoutEnabled={isCheckoutAvailable()} />;
}
