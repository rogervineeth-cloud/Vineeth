"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, ExternalLink, Loader2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { JobRecsResponse, RecommendationView } from "@/lib/job-recs/types";

type ErrorBody = { error?: string; code?: string; retry_after?: number };

const COMPONENT_LABELS: Record<string, string> = {
  skills: "Skills",
  title: "Role",
  experience: "Experience",
  location: "Location",
};

async function call(url: string, init?: RequestInit): Promise<{ status: number; body: JobRecsResponse & ErrorBody }> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-stone-200 rounded-2xl p-6 space-y-3">
      <h2 className="font-serif text-2xl text-[#1a1a1a]">{title}</h2>
      <div className="text-sm text-[#4a4a4a] space-y-3">{children}</div>
    </section>
  );
}

function JobCard({ rec, onAction, busy }: {
  rec: RecommendationView;
  onAction: (rec: RecommendationView, action: "save" | "dismiss" | "reset") => void;
  busy: boolean;
}) {
  const saved = rec.status === "saved";
  const skills = rec.components.skills;
  return (
    <li className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-[#1a1a1a]">{rec.title}</h3>
          <p className="text-sm text-[#6b6b6b]">{rec.company}</p>
          <p className="text-xs text-[#6b6b6b] flex items-center gap-1 mt-1">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            {rec.remote ? "Remote" : rec.location ?? "Location not stated"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-semibold text-[#1f5c3a]">{rec.score}%</p>
          <p className="text-[11px] text-[#6b6b6b]">match</p>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-[#1f5c3a]">Why this job?</summary>
        <ul className="mt-2 space-y-1 text-[#4a4a4a]">
          {Object.entries(rec.components).map(([name, c]) => (
            <li key={name}>
              <span className="font-medium">{COMPONENT_LABELS[name] ?? name}</span>{" "}
              <span className="text-xs text-[#6b6b6b]">({Math.round(c.score * 100)}%, weight {Math.round(c.weight * 100)}%)</span>: {c.reason}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[#6b6b6b]">Scored by rules ({rec.scoring_version}) using only what is on your resume.</p>
      </details>

      {(skills.matched?.length || skills.missing?.length) ? (
        <div className="flex flex-wrap gap-1.5">
          {skills.matched?.map((s) => <Badge key={`m-${s}`} variant="green">{s}</Badge>)}
          {skills.missing?.map((s) => <Badge key={`x-${s}`} variant="amber">{s}</Badge>)}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button asChild size="sm">
          <a href={rec.apply_url} target="_blank" rel="noopener noreferrer nofollow">
            Apply <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction(rec, saved ? "reset" : "save")} aria-pressed={saved}>
          {saved ? <BookmarkCheck className="w-4 h-4" aria-hidden="true" /> : <Bookmark className="w-4 h-4" aria-hidden="true" />}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction(rec, "dismiss")}>
          <X className="w-4 h-4" aria-hidden="true" /> Not for me
        </Button>
      </div>
    </li>
  );
}

export default function JobRecommendationsClient() {
  const [data, setData] = useState<JobRecsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  // One key per deliberate "Find jobs"; reused only when retrying a request
  // whose response was lost, so the server returns the same run.
  const pendingKey = useRef<string | null>(null);

  // Loads the current state. Returns a state update to apply, so the initial
  // load can apply it asynchronously (no setState inside the effect body).
  const fetchState = useCallback(async (): Promise<() => void> => {
    try {
      const { status, body } = await call("/api/job-recommendations");
      if (status === 429) { const at = Date.now() + (body.retry_after ?? 60) * 1000; return () => setRetryAt(at); }
      if (status !== 200) return () => setLoadError(body.error ?? "We couldn't load your recommendations.");
      return () => { setLoadError(null); setData(body); };
    } catch {
      return () => setLoadError("We couldn't reach the server. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchState().then((apply) => { if (alive) apply(); });
    return () => { alive = false; };
  }, [fetchState]);

  async function reload() {
    setLoadError(null);
    (await fetchState())();
  }

  useEffect(() => {
    if (!retryAt) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryAt) setRetryAt(null);
    }, 1000);
    return () => clearInterval(t);
  }, [retryAt]);

  const inFlight = useRef(false);
  async function findJobs() {
    // Synchronous lock: two clicks in one frame must not start two runs.
    if (inFlight.current) return;
    inFlight.current = true;
    if (!pendingKey.current) pendingKey.current = crypto.randomUUID();
    setRunning(true);
    try {
      const { status, body } = await call("/api/job-recommendations", {
        method: "POST",
        body: JSON.stringify({ request_key: pendingKey.current }),
      });
      pendingKey.current = null;
      if (status === 429) {
        setRetryAt(Date.now() + (body.retry_after ?? 60) * 1000);
        return;
      }
      if (body.state) {
        setData(body);
        return;
      }
      toast.error(body.error ?? "We couldn't find jobs right now. Please try again.");
    } catch {
      // Network failure: keep the key so a retry cannot create a second run.
      toast.error("We couldn't reach the server. Please try again.");
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  async function consent(action: "grant" | "revoke") {
    const { status, body } = await call("/api/job-recommendations/consent", { method: "POST", body: JSON.stringify({ action }) });
    if (status === 429) { setRetryAt(Date.now() + (body.retry_after ?? 60) * 1000); return; }
    if (!body.state) { toast.error(body.error ?? "Please try again."); return; }
    setData(body);
    if (action === "revoke") toast.success("Consent withdrawn. Your job recommendations were deleted.");
  }

  async function onAction(rec: RecommendationView, action: "save" | "dismiss" | "reset") {
    setBusyId(rec.id);
    try {
      const { status, body } = await call(`/api/job-recommendations/${rec.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      if (status === 429) { setRetryAt(Date.now() + (body.retry_after ?? 60) * 1000); return; }
      if (status !== 200) { toast.error(body.error ?? "Please try again."); return; }
      setData((d) => {
        if (!d?.run) return d;
        const recs = action === "dismiss"
          ? d.run.recommendations.filter((r) => r.id !== rec.id)
          : d.run.recommendations.map((r) => (r.id === rec.id ? { ...r, status: action === "save" ? "saved" as const : "new" as const } : r));
        return { ...d, state: recs.length ? d.state : "empty", run: { ...d.run, recommendations: recs } };
      });
    } finally {
      setBusyId(null);
    }
  }

  const retrySeconds = retryAt ? Math.max(1, Math.ceil((retryAt - now) / 1000)) : 0;
  const rateBanner = retryAt ? (
    <div role="status" className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm">
      You&apos;ve asked for recommendations a lot in a short time. You can try again in {retrySeconds >= 60 ? `${Math.ceil(retrySeconds / 60)} min` : `${retrySeconds} s`}.
    </div>
  ) : null;

  const findButton = (label: string) => (
    <Button onClick={() => findJobs()} disabled={running || !!retryAt}>
      {running ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Finding jobs…</> : label}
    </Button>
  );

  let content: React.ReactNode;
  if (loadError) {
    content = (
      <Panel title="Something went wrong">
        <p>{loadError}</p>
        <Button variant="outline" onClick={reload}>Try again</Button>
      </Panel>
    );
  } else if (!data) {
    content = (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-[#6b6b6b]">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading your job recommendations…
      </div>
    );
  } else if (data.state === "unavailable") {
    content = (
      <Panel title="Not available yet">
        <p>Job recommendations aren&apos;t available yet: we haven&apos;t connected an approved job source. Nothing from your resume has been shared with anyone.</p>
        <Link href="/dashboard" className="text-[#1f5c3a] underline underline-offset-2">Back to dashboard</Link>
      </Panel>
    );
  } else if (data.state === "consent_required") {
    content = (
      <Panel title="Before we look for jobs">
        <p>To suggest jobs, we match your resume against openings from our job source. Here is exactly what is used:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Sent to the job source:</strong> your target roles, the job titles you&apos;ve held, and the skills you listed.</li>
          <li><strong>Used only on our server:</strong> your years of experience and your city, to rank the results.</li>
          <li><strong>Never used or sent:</strong> your name, email, phone number, full resume, or any personal traits.</li>
        </ul>
        <p>Suggestions are scored by simple, explainable rules. You can withdraw consent at any time, which deletes your recommendations.</p>
        <Button onClick={() => consent("grant")}>I agree, find jobs for me</Button>
      </Panel>
    );
  } else if (data.state === "insufficient_resume") {
    content = (
      <Panel title="Your resume needs a little more">
        <p>We only match on what you&apos;ve written, and there isn&apos;t enough to go on yet:</p>
        <ul className="list-disc pl-5">
          {data.missing?.includes("titles") && <li>Add a target role, or a job title in your experience.</li>}
          {data.missing?.includes("skills") && <li>List at least two skills.</li>}
        </ul>
        <Button asChild variant="outline"><Link href="/profile">Update my profile</Link></Button>
      </Panel>
    );
  } else if (data.state === "ready") {
    content = (
      <Panel title="Find jobs that fit your resume">
        <p>We&apos;ll score openings against your target roles, job titles, skills, experience and city.</p>
        {findButton("Find jobs")}
      </Panel>
    );
  } else if (data.state === "empty") {
    content = (
      <Panel title="No matches right now">
        <p>We didn&apos;t find jobs that match your roles or skills this time. New openings arrive regularly, so check back later, or add more skills to your profile.</p>
        <div className="flex gap-2">{findButton("Search again")}<Button asChild variant="ghost"><Link href="/profile">Edit profile</Link></Button></div>
      </Panel>
    );
  } else {
    const recs = data.run?.recommendations ?? [];
    content = (
      <div className="space-y-4">
        {data.state === "partial" && (
          <div role="status" className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm">
            These results may be incomplete: the job source returned only part of its list, or some jobs were left out because their apply links weren&apos;t secure.
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[#6b6b6b]">{recs.length} job{recs.length === 1 ? "" : "s"} matched to your resume</p>
          {findButton("Refresh")}
        </div>
        <ul className="space-y-3">
          {recs.map((r) => <JobCard key={r.id} rec={r} onAction={onAction} busy={busyId === r.id} />)}
        </ul>
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-4xl text-[#1a1a1a]">Job recommendations</h1>
        <p className="text-sm text-[#6b6b6b]">Openings matched to the roles and skills on your resume.</p>
      </header>
      {rateBanner}
      {content}
      {data?.consent.granted && (
        <p className="text-xs text-[#6b6b6b]">
          <button type="button" onClick={() => consent("revoke")} className="underline underline-offset-2 hover:text-[#1a1a1a]">
            Withdraw consent and delete my job recommendations
          </button>
        </p>
      )}
    </main>
  );
}
