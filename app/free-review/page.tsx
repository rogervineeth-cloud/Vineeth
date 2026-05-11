import { notFound } from "next/navigation";
import { isPricingV2Enabled } from "@/lib/feature-flags";
import FreeReviewClient from "./FreeReviewClient";

export default function FreeReviewPage() {
  if (!isPricingV2Enabled()) notFound();
  return <FreeReviewClient />;
}
