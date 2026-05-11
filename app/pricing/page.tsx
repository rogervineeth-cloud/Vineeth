import { isPricingV2Enabled } from "@/lib/feature-flags";
import PricingClient from "./PricingClient";

export default function PricingPage() {
  return <PricingClient pricingV2={isPricingV2Enabled()} />;
}
