// Shapes returned by the job-recommendations API and shown by the UI.

import type { ComponentName, ScoreComponent } from "@/lib/job-recs/scoring";

export type RecStatus = "new" | "saved" | "dismissed";

export type RecommendationView = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  apply_url: string;
  posted_at: string | null;
  score: number;
  status: RecStatus;
  scoring_version: string;
  components: Record<ComponentName, ScoreComponent>;
};

export type RunView = {
  id: string;
  created_at: string;
  status: "results" | "empty" | "partial";
  dropped_count: number;
  scoring_version: string;
  recommendations: RecommendationView[];
};

export type JobRecsState =
  | "unavailable"          // no approved provider in this environment
  | "consent_required"     // the user has not agreed (or agreed to an older version)
  | "insufficient_resume"  // not enough explicit facts to match on
  | "ready"                // consented, enough facts, no run yet
  | "empty"                // latest run found nothing relevant
  | "partial"              // latest run: some results, provider set incomplete
  | "results";

export type JobRecsResponse = {
  state: JobRecsState;
  consent: { granted: boolean; version: string };
  missing?: ("titles" | "skills")[];
  run?: RunView;
};
