import type { ExperienceEntry, EducationEntry, ProjectEntry } from "./resume-parser";

export type ProfileExperience = ExperienceEntry;
export type ProfileEducation = EducationEntry;
export type ProfileProject = ProjectEntry;

export type ProfileData = {
  summary?: string;
  experience?: ProfileExperience[];
  education?: ProfileEducation[];
  projects?: ProfileProject[];
  skills?: string[];
  certifications?: string[];
  achievements?: string[];
  isFresher?: boolean;
  expSkipped?: boolean;
  eduSkipped?: boolean;
  projSkipped?: boolean;
};
