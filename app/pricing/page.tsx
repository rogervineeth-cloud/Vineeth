import { isPricingV2Enabled } from "@/lib/feature-flags";
import PricingClient from "./PricingClient";

// The paid pricing page as it was before commit 7709d56, restored. Payments
// are not integrated: PricingClient's purchase buttons are disabled
// ("Payments coming soon") and make no requests. The Free Beta offer (3
// generations per account) is shown first, as what is available now.
export default function PricingPage() {
  return <PricingClient pricingV2={isPricingV2Enabled()} />;
}
