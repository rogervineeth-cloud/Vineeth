"use client";
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { linkedinJobsSearchUrl, MAX_FIELD_CHARS, OUTBOUND_REL } from "@/lib/linkedin-jobs";

export const LINKEDIN_COMPANION_NOTICE =
  "This opens LinkedIn's own job search in a new tab. Neduresume doesn't fetch, scrape, rank or save LinkedIn listings, and doesn't save the role or location you type here.";

/**
 * The outbound link itself. A plain anchor (no script, no tracking) to the
 * fixed LinkedIn Jobs URL, in a new tab with no opener, no Referer and no
 * endorsement.
 */
export function LinkedinSearchLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel={OUTBOUND_REL}
      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1f5c3a] px-4 h-10 text-sm font-medium text-white hover:bg-[#174d30] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f5c3a] focus-visible:ring-offset-2"
    >
      Search jobs on LinkedIn
      <ExternalLink className="w-4 h-4" aria-hidden="true" />
      <span className="sr-only">(opens linkedin.com in a new tab)</span>
    </a>
  );
}

/**
 * Dashboard companion: the user types a role and location and opens
 * LinkedIn's job search for them. Nothing is sent to Neduresume — there is no
 * form submission, request, storage or analytics here. A job they find is
 * tailored for by pasting its description into /create.
 */
export default function LinkedinJobSearch() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const href = linkedinJobsSearchUrl(role, location);

  return (
    <section aria-labelledby="linkedin-jobs-heading" className="mt-12 bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
      <h2 id="linkedin-jobs-heading" className="font-serif italic text-2xl text-[#1a1a1a] mb-1 flex items-center gap-2">
        <Search className="w-5 h-5 text-[#1f5c3a]" aria-hidden="true" />
        Find jobs on LinkedIn
      </h2>
      <p id="linkedin-jobs-notice" className="text-sm text-[#6b6b6b] mb-5">{LINKEDIN_COMPANION_NOTICE}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="linkedin-jobs-role">Role</Label>
          <Input
            id="linkedin-jobs-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Backend Engineer"
            maxLength={MAX_FIELD_CHARS}
            autoComplete="off"
            aria-describedby="linkedin-jobs-notice"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="linkedin-jobs-location">Location <span className="font-normal text-[#6b6b6b]">(optional)</span></Label>
          <Input
            id="linkedin-jobs-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Bengaluru"
            maxLength={MAX_FIELD_CHARS}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {href ? (
          <LinkedinSearchLink href={href} />
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1f5c3a] px-4 h-10 text-sm font-medium text-white opacity-50 cursor-not-allowed"
          >
            Search jobs on LinkedIn
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        {!href && <p className="text-xs text-[#6b6b6b]">Type a role to search.</p>}
      </div>

      <div className="mt-6 pt-4 border-t border-stone-100 text-sm text-[#1a1a1a]">
        Found a job you like? Copy its job description, then{" "}
        <Link href="/create" className="font-medium text-[#1f5c3a] underline underline-offset-2">
          tailor your resume to it →
        </Link>
      </div>
    </section>
  );
}
