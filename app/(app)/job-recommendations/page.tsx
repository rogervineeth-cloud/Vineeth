import { notFound } from "next/navigation";
import { isJobRecsEnabled } from "@/lib/job-recs/config";
import JobRecommendationsClient from "./JobRecommendationsClient";

// Read the flag per request, not at build time.
export const dynamic = "force-dynamic";

export default function JobRecommendationsPage() {
  if (!isJobRecsEnabled()) notFound();
  return <JobRecommendationsClient />;
}
