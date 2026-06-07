/**
 * lib/profile-completeness.ts
 * Single source of truth for profile completeness validation.
 * Used by both the client wizard (create/page.tsx, profile/page.tsx)
 * and the server route (api/generate-resume/route.ts) to ensure
 * they never disagree about whether a profile is ready to generate.
 */

export type ExperienceEntry = {
  company: string;
  role: string;
  duration: string;
  location?: string;
  bullets: string[];
};

export type EducationEntry = {
  institution: string;
  degree: string;
  year: string;
  location?: string;
  cgpa?: string;
};

export type ProjectEntry = {
  name: string;
  description: string;
  tech: string[];
};

export type ProfileForCompleteness = {
  full_name?: string | null;
  email?: string | null;
  target_roles?: string[] | null;
  profile_data?: {
    experience?: ExperienceEntry[];
    education?: EducationEntry[];
    projects?: ProjectEntry[];
    skills?: string[];
    summary?: string;
  } | null;
};

// Field labels shown to users in error messages
export const FIELD_LABEL: Record<string, string> = {
  full_name: "your full name",
  email: "a valid email address",
  target_roles: "at least one target role",
  education: "at least one education entry",
  experience_or_projects:
    "one complete work experience (company, role, dates, and a bullet) or one project",
};

/**
 * Returns true if an experience entry is "valid" — i.e. has enough
 * data that the AI can use it meaningfully.
 */
export function isValidExperience(e: ExperienceEntry): boolean {
  const hasCompany =
    !!e?.company?.trim() &&
    !/previous organi[sz]ation/i.test(e.company) &&
    !/^(company|employer|n\/a|none|tbd)$/i.test(e.company.trim());
  const hasRole = !!e?.role?.trim();
  const hasDuration = !!e?.duration?.trim();
  const hasBullets = (e?.bullets ?? []).some((b) => b?.trim());
  return hasCompany && hasRole && hasDuration && hasBullets;
}

/**
 * Returns true if an education entry has at minimum an institution name.
 */
export function isValidEducation(e: EducationEntry): boolean {
  return !!e?.institution?.trim();
}

/**
 * Returns an array of missing field keys. Empty array = profile is complete.
 * This is the canonical completeness check — use it everywhere.
 */
export function getMissingFields(profile: ProfileForCompleteness | null): string[] {
  const missing: string[] = [];

  if (!profile?.full_name?.trim()) missing.push("full_name");

  // Basic email format check
  const emailVal = profile?.email?.trim() ?? "";
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal);
  if (!emailVal || !emailValid) missing.push("email");

  if (!(profile?.target_roles?.length)) missing.push("target_roles");

  const pd = profile?.profile_data;

  // Education: need at least one valid entry
  const validEdu = (pd?.education ?? []).filter(isValidEducation);
  if (validEdu.length === 0) missing.push("education");

  // Experience OR projects: need at least one valid entry
  const validExp = (pd?.experience ?? []).filter(isValidExperience);
  const hasProject = (pd?.projects ?? []).some(
    (pr) => pr?.name?.trim() && pr?.description?.trim()
  );
  if (validExp.length === 0 && !hasProject) missing.push("experience_or_projects");

  return missing;
}

/**
 * Convenience helper — returns { complete, missing } for UI use.
 * `missing` is a human-readable string of what's needed.
 */
export function checkProfileCompleteness(profile: ProfileForCompleteness | null): {
  complete: boolean;
  missing: string;
} {
  const fields = getMissingFields(profile);
  if (fields.length === 0) return { complete: true, missing: "" };
  const labels = fields.map((f) => FIELD_LABEL[f] ?? f);
  return { complete: false, missing: labels.join(", ") };
}
