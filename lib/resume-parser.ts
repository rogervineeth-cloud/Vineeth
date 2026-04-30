// Section-aware resume text parser.
//
// Extracted from app/api/parse-resume/route.ts so it can be unit-tested in
// isolation. Pure function: takes the plain text from a PDF (or any other
// source) and returns a normalised ExtractedProfile shape that the onboarding
// UI can pre-fill.
//
// Design priorities, in order:
//   1) Never throw. Always return a populated profile, even if mostly empty.
//   2) Tolerate the wide range of resume layouts users upload (single-column,
//      two-column, LinkedIn export, ATS template, Indian fresher format, etc).
//   3) Recognise section headers in many forms — any case, with or without a
//      trailing colon, with bullet-glyph leaders, or inlined ("Skills: a, b").
//   4) Best-effort: if a line can't be classified confidently, keep it in the
//      running section instead of dropping the file.

export interface ExperienceEntry {
  company: string;
  role: string;
  duration: string;
  location: string;
  bullets: string[];
}

export interface EducationEntry {
  institution: string;
  degree: string;
  year: string;
  location: string;
  cgpa?: string;
}

export interface ProjectEntry {
  name: string;
  description: string;
  tech: string[];
}

export interface ExtractedProfile {
  name: string;
  email: string;
  phone: string;
  city: string;
  graduation_year: number | null;
  summary: string | null;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
  projects: ProjectEntry[];
  certifications: string[];
  achievements: string[];
}

// Canonical section bucket names. Keep this list small — every alias maps to
// one of these. Adding a new bucket also requires plumbing it through
// extractProfile().
type Section =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "achievements";

const SECTION_ALIASES: Record<string, Section> = {
  // ── Summary / objective ────────────────────────────────────────────────
  "summary": "summary",
  "professional summary": "summary",
  "career summary": "summary",
  "executive summary": "summary",
  "profile": "summary",
  "professional profile": "summary",
  "personal profile": "summary",
  "about": "summary",
  "about me": "summary",
  "objective": "summary",
  "career objective": "summary",
  "professional objective": "summary",
  "overview": "summary",
  "introduction": "summary",
  "bio": "summary",

  // ── Experience / employment ────────────────────────────────────────────
  "experience": "experience",
  "work experience": "experience",
  "professional experience": "experience",
  "industry experience": "experience",
  "relevant experience": "experience",
  "employment": "experience",
  "employment history": "experience",
  "career history": "experience",
  "work history": "experience",
  "career": "experience",
  "internship": "experience",
  "internships": "experience",
  "internship experience": "experience",

  // ── Education ──────────────────────────────────────────────────────────
  "education": "education",
  "educational background": "education",
  "educational qualifications": "education",
  "academic background": "education",
  "academics": "education",
  "academic": "education",
  "qualifications": "education",
  "academic qualifications": "education",
  "academic record": "education",
  "schooling": "education",

  // ── Skills ─────────────────────────────────────────────────────────────
  "skills": "skills",
  "technical skills": "skills",
  "key skills": "skills",
  "core skills": "skills",
  "professional skills": "skills",
  "core competencies": "skills",
  "competencies": "skills",
  "areas of expertise": "skills",
  "expertise": "skills",
  "tools": "skills",
  "tools and technologies": "skills",
  "tools & technologies": "skills",
  "technologies": "skills",
  "tech stack": "skills",
  "skill set": "skills",
  "it skills": "skills",
  "computer skills": "skills",

  // ── Projects ───────────────────────────────────────────────────────────
  "projects": "projects",
  "personal projects": "projects",
  "academic projects": "projects",
  "key projects": "projects",
  "side projects": "projects",
  "open source": "projects",
  "open source contributions": "projects",
  "selected projects": "projects",
  "notable projects": "projects",

  // ── Certifications & training ──────────────────────────────────────────
  "certifications": "certifications",
  "certificates": "certifications",
  "courses": "certifications",
  "courses & certifications": "certifications",
  "courses and certifications": "certifications",
  "online courses": "certifications",
  "training": "certifications",
  "trainings": "certifications",
  "professional development": "certifications",
  "licenses": "certifications",
  "licenses and certifications": "certifications",

  // ── Achievements / awards ──────────────────────────────────────────────
  "achievements": "achievements",
  "key achievements": "achievements",
  "accomplishments": "achievements",
  "awards": "achievements",
  "awards and recognition": "achievements",
  "awards & recognition": "achievements",
  "honors": "achievements",
  "honours": "achievements",
  "honors and awards": "achievements",
  "publications": "achievements",
  "presentations": "achievements",
  "extra curricular activities": "achievements",
  "extracurricular activities": "achievements",
  "extra-curricular": "achievements",
  "activities": "achievements",
  "leadership": "achievements",
  "leadership experience": "achievements",
  "positions of responsibility": "achievements",
  "volunteer": "achievements",
  "volunteer experience": "achievements",
  "volunteering": "achievements",
};

function normaliseHeader(line: string): string {
  return line
    // Strip leading bullet glyphs and decorative chars before the header word.
    .replace(/^[\s•·●▪◦‣*\-–—]+/, "")
    // Strip trailing colons / decorative chars.
    .replace(/[:•·●▪◦‣*\-–—_]+\s*$/, "")
    .toLowerCase()
    .replace(/[&\/]/g, " and ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySection(line: string): Section | null {
  if (!line) return null;
  const norm = normaliseHeader(line);
  if (norm.length === 0 || norm.length > 45) return null;
  if (SECTION_ALIASES[norm]) return SECTION_ALIASES[norm];
  // "and" variants: "courses and certifications" already handled above, but
  // try removing it as a last attempt for rarer phrasings.
  const without = norm.replace(/\b(and|&)\b/g, "").replace(/\s+/g, " ").trim();
  if (without && without !== norm && SECTION_ALIASES[without]) return SECTION_ALIASES[without];
  return null;
}

// Some resumes write a header inline with content, e.g. "Skills: Python, JS".
// Detect that and split the line into a header + remainder so the body isn't
// dropped on the floor.
export function splitInlineHeader(line: string): { section: Section; rest: string } | null {
  // Up to ~45 chars of header before the colon/dash separator.
  const m = line.match(/^([A-Za-z][A-Za-z &\/]{1,45}?)\s*[:\-–—]\s*(.+)$/);
  if (!m) return null;
  const section = classifySection(m[1]);
  if (!section) return null;
  const rest = m[2].trim();
  if (!rest) return null;
  return { section, rest };
}

export function extractEmail(text: string): string {
  const m = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : "";
}

// Tightened phone regex. Requires at least 10 digits in the matched span so we
// don't accidentally pick up dates or short numeric tokens.
export function extractPhone(text: string): string {
  // Try a few patterns in priority order.
  const patterns: RegExp[] = [
    // +91 98765 43210 / +1 (415) 555-1234 / +44 20 7946 0958
    /\+\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,5}[\s\-]?\d{3,5}/,
    // (415) 555-1234 / 415-555-1234 / 415.555.1234
    /\(?\d{3,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,5}/,
    // 9876543210 (raw 10-digit Indian mobile)
    /\b\d{10}\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;
    return m[0].trim();
  }
  return "";
}

const KNOWN_CITIES = [
  "Mumbai", "Delhi", "New Delhi", "Bangalore", "Bengaluru", "Chennai", "Hyderabad", "Pune",
  "Kolkata", "Ahmedabad", "Kochi", "Trivandrum", "Thiruvananthapuram", "Jaipur",
  "Lucknow", "Chandigarh", "Coimbatore", "Noida", "Gurugram", "Gurgaon", "Indore",
  "Bhopal", "Nagpur", "Surat", "Vadodara", "Visakhapatnam", "Mysore", "Mysuru",
  "Mangalore", "Mangaluru", "Vijayawada", "Bhubaneswar", "Patna", "Ranchi",
  "Guwahati", "Shillong", "Faridabad", "Ghaziabad", "Greater Noida",
  "London", "Singapore", "Dubai", "San Francisco", "New York", "Seattle",
  "Austin", "Toronto", "Berlin", "Paris", "Sydney", "Boston", "Chicago",
  "Los Angeles", "Tokyo", "Hong Kong", "Amsterdam", "Dublin", "Zurich",
];

export function extractCity(text: string): string {
  // Prefer longer matches first so "New Delhi" beats "Delhi" and
  // "Greater Noida" beats "Noida".
  const ordered = [...KNOWN_CITIES].sort((a, b) => b.length - a.length);
  for (const c of ordered) {
    const re = new RegExp("\\b" + c.replace(/\s+/g, "\\s+") + "\\b", "i");
    if (re.test(text)) return c;
  }
  return "";
}

export function extractName(lines: string[], email: string): string {
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (ln.includes("@")) continue;
    if (/\d{6,}/.test(ln)) continue;
    if (classifySection(ln)) continue;
    // Skip lines that look like contact-info clusters ("Mumbai | foo@bar.com").
    if (/[|·•]/.test(ln)) continue;
    const words = ln.split(/\s+/);
    if (words.length < 1 || words.length > 5) continue;
    const lettersOnly = ln.replace(/[^A-Za-z\s.\-']/g, "");
    if (lettersOnly.length < ln.length * 0.7) continue;
    // Avoid treating obvious contact lines / addresses as the name.
    if (/^(phone|email|mobile|address|linkedin|github|portfolio)\b/i.test(ln)) continue;
    return ln;
  }
  if (email) {
    const local = email.split("@")[0].replace(/[._\-]+/g, " ");
    return local.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").trim();
  }
  return "";
}

// Date-range matcher. Covers month names, MM/YYYY, YYYY ranges, and Present /
// Current / Now / Till date / Ongoing as the closing token.
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE_TOKEN = `(?:${MONTH}\\s*[\\'’]?\\s*\\d{0,4}|\\d{1,2}\\/\\d{2,4}|\\d{4})`;
const END_TOKEN = `(?:Present|Current|Now|Ongoing|Till\\s+date|To\\s+date|${DATE_TOKEN})`;
const DATE_RANGE_RE = new RegExp(
  `${DATE_TOKEN}\\s*[\\-–—]+\\s*${END_TOKEN}|${DATE_TOKEN}\\s+to\\s+${END_TOKEN}`,
  "i",
);

export function findDateRange(line: string): string | null {
  const m = line.match(DATE_RANGE_RE);
  return m ? m[0].trim() : null;
}

export function isBullet(line: string): boolean {
  return /^\s*[•·●▪◦‣*]/.test(line) || /^\s*[\-–—]\s+/.test(line);
}

export function stripBullet(line: string): string {
  return line.replace(/^\s*[•·●▪◦‣*]\s?/, "").replace(/^\s*[\-–—]\s+/, "").trim();
}

export function extractGraduationYear(text: string, eduText: string): number | null {
  const haystack = (eduText || text).slice(0, 4000);
  const matches = haystack.match(/\b(19|20)\d{2}\b/g);
  if (!matches) return null;
  const nums = matches.map(Number).filter((n) => n >= 1980 && n <= new Date().getFullYear() + 6);
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

const ROLE_HINT_RE =
  /(engineer|developer|manager|analyst|designer|consultant|lead|architect|scientist|director|specialist|associate|intern|executive|officer|administrator|coordinator|representative|accountant|teacher|professor|founder|co-founder|cofounder|head\s+of|vp\b|chief|product\b|marketing|sales|sde|swe|qa|tester)/i;

const DEGREE_HINT_RE =
  /(b\.?\s*tech|b\.?\s*e\b|bachelor|m\.?\s*tech|m\.?\s*e\b|master|mba|mca|bca|bba|b\.?\s*sc|m\.?\s*sc|b\.?\s*a\b|m\.?\s*a\b|ph\.?\s*d|diploma|class\s*(?:x|xii|10|12)|hsc|ssc|secondary|higher\s+secondary|matriculation|gcse|a-?level)/i;

export function parseExperienceBlock(block: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;
  const flush = () => {
    if (cur && (cur.company || cur.role || cur.bullets.length)) entries.push(cur);
    cur = null;
  };
  const lines = block.map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBullet(line)) {
      if (!cur) cur = { company: "", role: "", duration: "", location: "", bullets: [] };
      cur.bullets.push(stripBullet(line));
      continue;
    }
    const dateRange = findDateRange(line);
    if (dateRange) {
      // A new entry usually begins on a date-bearing line. Flush the previous.
      flush();
      cur = { company: "", role: "", duration: dateRange, location: "", bullets: [] };
      const remainder = line.replace(DATE_RANGE_RE, "").replace(/\s+/g, " ").trim();
      const sep = remainder.split(/\s+[\-–—|·@]\s+|,\s+/).map((s) => s.trim()).filter(Boolean);
      if (sep.length >= 2) {
        if (ROLE_HINT_RE.test(sep[0])) { cur.role = sep[0]; cur.company = sep[1]; }
        else if (ROLE_HINT_RE.test(sep[1])) { cur.company = sep[0]; cur.role = sep[1]; }
        else { cur.company = sep[0]; cur.role = sep[1]; }
        if (sep.length >= 3) {
          // A trailing token that matches a known city becomes the location.
          const maybeCity = KNOWN_CITIES.find((c) => new RegExp("\\b" + c + "\\b", "i").test(sep[2]));
          if (maybeCity) cur.location = maybeCity;
        }
      } else if (sep.length === 1) {
        if (ROLE_HINT_RE.test(sep[0])) cur.role = sep[0];
        else cur.company = sep[0];
      }
      // Look ahead one line for company/role if the date-line only had one of them.
      const next = lines[i + 1];
      if (next && !isBullet(next) && !findDateRange(next) && next.length < 90) {
        if (cur.role && !cur.company && !ROLE_HINT_RE.test(next)) {
          cur.company = next;
          i++;
        } else if (cur.company && !cur.role && ROLE_HINT_RE.test(next)) {
          cur.role = next;
          i++;
        }
      }
      continue;
    }
    if (!cur) {
      // No date yet — first non-bullet line starts a new entry as company.
      cur = { company: line, role: "", duration: "", location: "", bullets: [] };
      continue;
    }
    // Within an existing entry: try to attach role/location, else keep as a
    // bullet (some resumes write achievements as plain paragraphs).
    if (!cur.role && ROLE_HINT_RE.test(line) && line.length < 80) {
      cur.role = line;
    } else if (!cur.location) {
      const cityMatch = KNOWN_CITIES.find((c) => new RegExp("\\b" + c + "\\b", "i").test(line));
      if (cityMatch && line.length < 80) {
        cur.location = cityMatch;
        continue;
      }
      cur.bullets.push(line);
    } else {
      cur.bullets.push(line);
    }
  }
  flush();
  return entries;
}

export function parseEducationBlock(block: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  let cur: EducationEntry | null = null;
  const flush = () => { if (cur && (cur.institution || cur.degree)) entries.push(cur); cur = null; };
  for (const raw of block) {
    const line = raw.trim();
    if (!line) continue;
    if (isBullet(line)) {
      // Bullet under an education entry — usually coursework / honours. Skip
      // for now (we don't expose a coursework field), but don't break the entry.
      continue;
    }
    if (DEGREE_HINT_RE.test(line)) {
      if (cur && cur.degree) flush();
      if (!cur) cur = { institution: "", degree: "", year: "", location: "" };
      cur.degree = line;
      // A degree line often contains the year too — try to peel it off.
      const yr = line.match(/\b(19|20)\d{2}\b/);
      if (yr && !cur.year) cur.year = yr[0];
      continue;
    }
    const cgpa = line.match(/(?:cgpa|gpa|percentage|aggregate)[^\d]*(\d+(?:\.\d+)?)/i);
    if (cgpa && cur) { cur.cgpa = cgpa[1]; continue; }
    const yr = line.match(/\b(19|20)\d{2}\b/);
    if (yr && cur && !cur.year) {
      cur.year = yr[0];
      const rest = line.replace(yr[0], "").replace(/[\-–—|,]/g, " ").replace(/\s+/g, " ").trim();
      if (rest && !cur.institution) cur.institution = rest;
      continue;
    }
    if (!cur) cur = { institution: "", degree: "", year: "", location: "" };
    if (!cur.institution) {
      cur.institution = line;
    } else if (!cur.location) {
      const cityMatch = KNOWN_CITIES.find((c) => new RegExp("\\b" + c + "\\b", "i").test(line));
      if (cityMatch) {
        cur.location = cityMatch;
      } else {
        // Different institution — start a new entry.
        flush();
        cur = { institution: line, degree: "", year: "", location: "" };
      }
    } else {
      flush();
      cur = { institution: line, degree: "", year: "", location: "" };
    }
  }
  flush();
  return entries;
}

export function parseSkillsBlock(block: string[]): string[] {
  // Some skills sections are written as "Languages: Python, Go" subgroups —
  // strip the leading label from each line before splitting.
  const cleaned = block.map((line) => line.replace(/^[A-Za-z][A-Za-z &\/]{0,30}\s*[:\-–—]\s*/, ""));
  const joined = cleaned.join(", ");
  return joined
    .split(/[,;|·•\n\/]/)
    .map((s) => s.replace(/^[-–—\s]+/, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 50)
    // de-dupe case-insensitively, preserve first-seen casing.
    .filter((s, i, arr) => arr.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i);
}

export function parseProjectsBlock(block: string[]): ProjectEntry[] {
  const entries: ProjectEntry[] = [];
  let cur: ProjectEntry | null = null;
  const flush = () => { if (cur && cur.name) entries.push(cur); cur = null; };
  for (const raw of block) {
    const line = raw.trim();
    if (!line) continue;
    if (isBullet(line)) {
      if (!cur) cur = { name: "Project", description: "", tech: [] };
      cur.description = cur.description ? cur.description + " " + stripBullet(line) : stripBullet(line);
      continue;
    }
    const techMatch = line.match(/^(?:tech(?:nologies)?|stack|tools|tech\s+stack|built\s+with)\s*[:\-–—]\s*(.+)$/i);
    if (techMatch && cur) {
      cur.tech = techMatch[1].split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (line.length < 80 && !line.endsWith(".")) {
      flush();
      cur = { name: line, description: "", tech: [] };
    } else {
      if (!cur) cur = { name: "Project", description: "", tech: [] };
      cur.description = cur.description ? cur.description + " " + line : line;
    }
  }
  flush();
  return entries;
}

export function parseListBlock(block: string[]): string[] {
  const items: string[] = [];
  let cur: string | null = null;
  for (const raw of block) {
    const line = raw.trim();
    if (!line) continue;
    if (isBullet(line)) {
      if (cur) items.push(cur);
      cur = stripBullet(line);
    } else if (cur && line.length > 0) {
      // Continuation of the previous bullet (wrapped paragraph).
      cur += " " + line;
    } else {
      // No leading bullet — treat each non-empty line as its own item.
      items.push(line);
    }
  }
  if (cur) items.push(cur);
  return items
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 300);
}

// PDF text extractors sometimes emit "-- N of M --" page-break markers; strip
// them before bucketing.
const PAGE_MARKER_RE = /^\s*-{1,3}\s*\d+\s+of\s+\d+\s*-{1,3}\s*$/i;

// Heuristic fallback: when the resume has NO explicit section headers (rare,
// but happens with some converted Word docs), put a best guess into experience
// based on lines that look like bullets or contain date ranges. Better than
// dropping everything.
function fallbackBucket(lines: string[]): { experience: string[]; skills: string[] } {
  const experience: string[] = [];
  const skills: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isBullet(line) || findDateRange(line)) {
      experience.push(line);
    } else if (/[A-Za-z]{2,},\s*[A-Za-z]{2,},\s*[A-Za-z]{2,}/.test(line) && line.length < 200) {
      // CSV-looking line with three+ comma-separated tokens — likely skills.
      skills.push(line);
    }
  }
  return { experience, skills };
}

export function extractProfile(text: string): ExtractedProfile {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/ /g, " ").trimEnd())
    .filter((l) => !PAGE_MARKER_RE.test(l));

  const buckets: Record<Section, string[]> = {
    summary: [],
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    achievements: [],
  };
  let active: Section | null = null;
  const headerLines: string[] = [];
  let sawAnyHeader = false;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const sec = classifySection(trimmed);
    if (sec) {
      active = sec;
      sawAnyHeader = true;
      continue;
    }
    const inline = splitInlineHeader(trimmed);
    if (inline) {
      active = inline.section;
      sawAnyHeader = true;
      buckets[active].push(inline.rest);
      continue;
    }
    if (active) {
      buckets[active].push(trimmed);
    } else {
      headerLines.push(trimmed);
    }
  }

  // No headers at all? Try a heuristic salvage so we still surface something.
  if (!sawAnyHeader) {
    const fb = fallbackBucket(lines);
    buckets.experience.push(...fb.experience);
    buckets.skills.push(...fb.skills);
  }

  const flat = lines.join("\n");
  const email = extractEmail(flat);
  const phone = extractPhone(flat);
  // Search the header block first (top of resume), then the whole document.
  const city = extractCity(headerLines.slice(0, 12).join("\n")) || extractCity(flat);
  const name = extractName(lines, email);
  const summary = buckets.summary.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 800) || null;
  const experience = parseExperienceBlock(buckets.experience);
  const education = parseEducationBlock(buckets.education);
  const skills = parseSkillsBlock(buckets.skills);
  const projects = parseProjectsBlock(buckets.projects);
  const certifications = parseListBlock(buckets.certifications);
  const achievements = parseListBlock(buckets.achievements);
  const graduation_year = extractGraduationYear(flat, buckets.education.join("\n"));

  return {
    name,
    email,
    phone,
    city,
    graduation_year,
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    achievements,
  };
}
