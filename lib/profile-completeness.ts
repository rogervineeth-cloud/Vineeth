// What a profile needs before a resume can be generated from it.
//
// Shared by the generate-resume route (the enforcing gate) and the profile and
// create pages (which must tell the user BEFORE they click Generate). Keeping
// one definition is the point: the defect this fixes was the two sides
// disagreeing.
//
// THE RULE
//   Experience, Education and Projects are each optional — the profile UI
//   labels them so and lets each be skipped. But at least ONE of them must
//   hold a real entry. With none, the only truthful resume is a name and an
//   email, and the model's anti-fabrication rules leave it nothing to write;
//   charging a credit for that, or letting the model fill the gap, are both
//   worse than asking the user for one entry.
//
// WHAT IT REPLACED (production QA, 2026-09-23)
//   The server required education to be non-empty AND a complete experience
//   entry or project. So an experienced user who skipped Education, or a
//   fresher with a degree but no project, was refused — even though the
//   generation prompt is written to handle exactly those profiles. And the
//   checks looked at array length, so the blank placeholder row the profile
//   page saves for a skipped section counted as content on one side and not
//   the other.

export type ExperienceLike = {
  company?: string | null;
  role?: string | null;
  duration?: string | null;
  bullets?: (string | null)[] | null;
};
export type EducationLike = { institution?: string | null };
export type ProjectLike = { name?: string | null; description?: string | null };

export type ProfileSectionsLike = {
  experience?: ExperienceLike[] | null;
  education?: EducationLike[] | null;
  projects?: ProjectLike[] | null;
};

const filled = (s: string | null | undefined) => !!s && s.trim().length > 0;

/**
 * A complete experience entry: real company, role, duration and at least one
 * bullet. Placeholder employer names do not count — the model would otherwise
 * be handed a career to embellish.
 */
export function isRealExperience(e: ExperienceLike | null | undefined): boolean {
  if (!e) return false;
  const company = (e.company ?? "").trim();
  const realCompany =
    filled(company) &&
    !/previous organi[sz]ation/i.test(company) &&
    !/^(company|employer|n\/a|none|tbd)$/i.test(company);
  const bullets = Array.isArray(e.bullets) ? e.bullets.filter(filled) : [];
  return realCompany && filled(e.role) && filled(e.duration) && bullets.length > 0;
}

export function isRealEducation(e: EducationLike | null | undefined): boolean {
  return !!e && filled(e.institution);
}

export function isRealProject(p: ProjectLike | null | undefined): boolean {
  return !!p && filled(p.name) && filled(p.description);
}

/** Each section with blank and placeholder rows removed. */
export function usableSections<
  E extends ExperienceLike,
  D extends EducationLike,
  P extends ProjectLike,
>(p: { experience?: E[] | null; education?: D[] | null; projects?: P[] | null }) {
  return {
    experience: (Array.isArray(p.experience) ? p.experience : []).filter(isRealExperience),
    education: (Array.isArray(p.education) ? p.education : []).filter(isRealEducation),
    projects: (Array.isArray(p.projects) ? p.projects : []).filter(isRealProject),
  };
}

/** True when at least one of Experience, Education, Projects has a real entry. */
export function hasResumeContent(p: ProfileSectionsLike | null | undefined): boolean {
  if (!p) return false;
  const u = usableSections(p);
  return u.experience.length > 0 || u.education.length > 0 || u.projects.length > 0;
}

/** Key returned in PROFILE_INCOMPLETE.missing when no section has content. */
export const MISSING_RESUME_CONTENT = "experience_education_or_projects";

/** User-facing wording for the same requirement. */
export const RESUME_CONTENT_HINT = "at least one work experience, education, or project entry";
