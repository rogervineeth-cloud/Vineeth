// LinkedIn job-search companion: builds a link to LinkedIn's OWN public job
// search for a role and location the user types. That is all it does.
//
// Neduresume never fetches, scrapes, ranks or stores LinkedIn listings, and
// never saves what the user types here. The only place the role and location
// go is the query string of a link the user chooses to open, in a new tab, on
// linkedin.com. The origin and path are fixed; user text only ever lands in
// the encoded `keywords` / `location` query values, so it cannot change where
// the link points.

export const LINKEDIN_JOBS_SEARCH_URL = "https://www.linkedin.com/jobs/search/";

/** Longest role / location kept, in characters (a search box, not an essay). */
export const MAX_FIELD_CHARS = 100;

/** Trimmed, single-spaced, control characters removed, length-capped. */
export function cleanSearchField(raw: string | null | undefined): string {
  return (raw ?? "")
    // Control characters (incl. newlines/tabs) become spaces.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_CHARS)
    .trim();
}

/**
 * The LinkedIn Jobs search URL for a role (required) and location
 * (optional), or null when there is no role to search for.
 */
export function linkedinJobsSearchUrl(role: string | null | undefined, location?: string | null): string | null {
  const keywords = cleanSearchField(role);
  if (!keywords) return null;
  const url = new URL(LINKEDIN_JOBS_SEARCH_URL);
  url.searchParams.set("keywords", keywords);
  const where = cleanSearchField(location);
  if (where) url.searchParams.set("location", where);
  return url.toString();
}

/** rel for the outbound link: no window.opener, no Referer, no endorsement. */
export const OUTBOUND_REL = "noopener noreferrer nofollow";
