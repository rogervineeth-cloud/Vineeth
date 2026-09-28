// Server-side allowlist of job sources. Only ids in APPROVED_PROVIDERS can be
// constructed; there is no dynamic import, URL or key taken from the request.

import type { JobRecsEnv, ProviderId } from "@/lib/job-recs/config";
import type { JobProviderAdapter } from "./types";
import { FixtureJobProvider } from "./fixture";

export function createProvider(id: ProviderId, env: JobRecsEnv = process.env): JobProviderAdapter {
  switch (id) {
    case "fixture":
      return new FixtureJobProvider(env);
  }
}
