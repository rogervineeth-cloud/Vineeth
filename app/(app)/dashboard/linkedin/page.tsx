import { notFound } from "next/navigation";
import { isPricingV2Enabled } from "@/lib/feature-flags";
import LinkedinRewriteClient from "./LinkedinRewriteClient";

export default function LinkedinRewritePage() {
  if (!isPricingV2Enabled()) notFound();
  return <LinkedinRewriteClient />;
}
