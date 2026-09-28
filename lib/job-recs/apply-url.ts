// Apply links come from a third party and end up as an <a href> in our UI, so
// they are validated on the server before they are stored:
//   * https only (no http:, javascript:, data:, mailto: ...)
//   * no embedded credentials (https://user:pass@host)
//   * a real public-looking hostname (no localhost, no bare IPs, has a dot)
//   * bounded length
// Anything else drops the job; it is never "fixed up".

export const MAX_APPLY_URL_LENGTH = 2048;

export function validApplyUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_APPLY_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null;
  return u.toString();
}
