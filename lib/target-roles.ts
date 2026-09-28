// Target roles: what the profile's "Roles" step saves and what generation
// tailors to.
//
// The role picker ends with an "Other" chip (lib/seed/roles.ts) for roles not
// in the list. Picking it used to add the literal string "Other" to
// target_roles, so a profile could be "complete" with no real role, and the
// generator was told the candidate was targeting "Other" (it is also the
// fallback tailored_role). "Other" now only opens a text field; what is saved
// is the role the user types. Every read and write goes through
// cleanTargetRoles, so a literal "Other" already stored is never used again.

export const OTHER_ROLE = "Other";
export const MAX_TARGET_ROLES = 3;
export const MAX_ROLE_LENGTH = 60;

/** "Other", "other", " OTHER " — the picker's sentinel, not a role. */
export function isOtherSentinel(role: string): boolean {
  return role.trim().toLowerCase() === OTHER_ROLE.toLowerCase();
}

/**
 * The roles that may be saved or tailored to: trimmed, non-blank, never the
 * "Other" sentinel, de-duplicated case-insensitively, at most three.
 */
export function cleanTargetRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  const out: string[] = [];
  for (const r of roles) {
    if (typeof r !== "string") continue;
    const role = r.trim().replace(/\s+/g, " ");
    if (!role || isOtherSentinel(role)) continue;
    if (out.some((x) => x.toLowerCase() === role.toLowerCase())) continue;
    out.push(role);
    if (out.length === MAX_TARGET_ROLES) break;
  }
  return out;
}

/** Why a typed role cannot be added, or null when it can. */
export function customRoleError(value: string, current: string[] = []): string | null {
  const role = value.trim().replace(/\s+/g, " ");
  if (!role) return "Type the role you're targeting, e.g. Supply Chain Analyst.";
  if (isOtherSentinel(role)) return "Type the actual role you're targeting, not \"Other\".";
  if (!/\p{L}/u.test(role)) return "A role needs at least one letter.";
  if (role.length > MAX_ROLE_LENGTH) return `Keep the role under ${MAX_ROLE_LENGTH} characters.`;
  if (current.some((x) => x.toLowerCase() === role.toLowerCase())) return "You've already added that role.";
  if (cleanTargetRoles(current).length >= MAX_TARGET_ROLES) return `Pick up to ${MAX_TARGET_ROLES} roles.`;
  return null;
}
