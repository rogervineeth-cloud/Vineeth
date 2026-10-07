// This is deliberately an outbound-link builder only. It never reads profile
// data or contacts LinkedIn (or another jobs service).
export function linkedInJobSearchUrl(role, location) {
  const keywords = role.trim();
  const place = location.trim();
  if (!keywords || !place) return null;

  const query = new URLSearchParams({ keywords, location: place });
  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}
