import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────
//   Robust resume / LinkedIn PDF parser
// ─────────────────────────────────────────────────────────────────────────
//   Goals
//   ─────
//   * Tolerate the wide variety of resume layouts users upload (single-column,
//     two-column, LinkedIn export, ATS template, etc.).
//   * Recognise section headers in any case ("EXPERIENCE", "Work Experience",
//     "Professional Experience", "Employment", "Career history" …).
//   * Pull bullets regardless of bullet glyph (•, –, -, ·, *, ●).
//   * Handle date ranges in many forms: "Jan 2020 - Mar 2022", "2018-2020",
//     "Sept'19 – Present", "01/2020 – 12/2022".
//   * Best-effort placement: if we can't classify a line confidently we drop it
//     into the running section instead of throwing the whole file away.
// ─────────────────────────────────────────────────────────────────────────

interface ExperienceEntry {
  company: string;
  role: string;
  duration: string;
  location: string;
  bullets: string[];
}
interface EducationEntry {
  institution: string;
  degree: string;
  year: string;
  location: string;
  cgpa?: string;
}
interface ProjectEntry {
  name: string;
  description: string;
  tech: string[];
}
interface ExtractedProfile {
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
}

const SECTION_ALIASES: Record<string, string> = {
  "summary": "summary",
  "professional summary": "summary",
  "profile": "summary",
  "about": "summary",
  "about me": "summary",
  "objective": "summary",
  "career objective": "summary",
  "experience": "experience",
  "work experience": "experience",
  "professional experience": "experience",
  "employment": "experience",
  "employment history": "experience",
  "career history": "experience",
  "work history": "experience",
  "education": "education",
  "academic background": "education",
  "academics": "education",
  "qualifications": "education",
  "academic qualifications": "education",
  "skills": "skills",
  "technical skills": "skills",
  "key skills": "skills",
  "core competencies": "skills",
  "competencies": "skills",
  "tools": "skills",
  "technologies": "skills",
  "projects": "projects",
  "personal projects": "projects",
  "academic projects": "projects",
  "key projects": "projects",
  "side projects": "projects",
  "open source": "projects",
};

function normaliseHeader(line: string): string {
  return line
    .toLowerCase()
    .replace(/[:•·\-—–_*●]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifySection(line: string): string | null {
  const norm = normaliseHeader(line);
  if (norm.length === 0 || norm.length > 40) return null;
  if (SECTION_ALIASES[norm]) return SECTION_ALIASES[norm];
  return null;
}

// Some resumes write a header inline with content, e.g. "Skills: Python, JS, AWS".
// Detect that and split the line into a header + remainder so we don't lose the body.
function splitInlineHeader(line: string): { section: string; rest: string } | null {
  const m = line.match(/^([A-Za-z][A-Za-z &\/]{1,35})\s*[:\-–—]\s*(.+)$/);
  if (!m) return null;
  const section = classifySection(m[1]);
  if (!section) return null;
  return { section, rest: m[2].trim() };
}

function extractEmail(text: string): string {
  const m = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : "";
}

function extractPhone(text: string): string {
  const m = text.match(/(?:\+?\d{1,3}[\s\-]?)?(?:\(?\d{2,4}\)?[\s\-]?)?\d{3,4}[\s\-]?\d{3,4}/);
  if (!m) return "";
  const digits = m[0].replace(/\D/g, "");
  if (digits.length < 7) return "";
  return m[0].trim();
}

const KNOWN_CITIES = [
  "Mumbai","Delhi","Bangalore","Bengaluru","Chennai","Hyderabad","Pune",
  "Kolkata","Ahmedabad","Kochi","Trivandrum","Thiruvananthapuram","Jaipur",
  "Lucknow","Chandigarh","Coimbatore","Noida","Gurugram","Gurgaon","Indore",
  "Bhopal","Nagpur","Surat","Vadodara","Visakhapatnam","Mysore","Mysuru",
  "Mangalore","Mangaluru","Vijayawada","Bhubaneswar","Patna","Ranchi",
  "Guwahati","Shillong","London","Singapore","Dubai","San Francisco",
  "New York","Seattle","Austin","Toronto","Berlin","Paris","Sydney",
];

function extractCity(text: string): string {
  for (const c of KNOWN_CITIES) {
    const re = new RegExp("\\b" + c + "\\b", "i");
    if (re.test(text)) return c;
  }
  return "";
}

function extractName(lines: string[], email: string): string {
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (ln.includes("@")) continue;
    if (/\d{6,}/.test(ln)) continue;
    if (classifySection(ln)) continue;
    const words = ln.split(/\s+/);
    if (words.length < 1 || words.length > 5) continue;
    const lettersOnly = ln.replace(/[^A-Za-z\s.\-]/g, "");
    if (lettersOnly.length < ln.length * 0.7) continue;
    return ln;
  }
  if (email) {
    const local = email.split("@")[0].replace(/[._\-]+/g, " ");
    return local.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return "";
}

const DATE_RANGE_RE = /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{0,4}|\d{1,2}\/\d{2,4}|\d{4})\s*[\-–—to]+\s*(?:Present|Current|Now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{0,4}|\d{1,2}\/\d{2,4}|\d{4})/i;

function isBullet(line: string): boolean {
  return /^\s*[•·●\-–—*▪◦‣]/.test(line);
}

function stripBullet(line: string): string {
  return line.replace(/^\s*[•·●\-–—*▪◦‣]\s?/, "").trim();
}

function extractGraduationYear(text: string, eduText: string): number | null {
  const haystack = (eduText || text).slice(0, 4000);
  const matches = haystack.match(/\b(19|20)\d{2}\b/g);
  if (!matches) return null;
  const nums = matches.map(Number).filter((n) => n >= 1980 && n <= new Date().getFullYear() + 6);
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

function parseExperienceBlock(block: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;
  const flush = () => { if (cur && (cur.company || cur.role || cur.bullets.length)) entries.push(cur); cur = null; };
  for (const raw of block) {
    const line = raw.trim();
    if (!line) continue;
    if (isBullet(line)) {
      if (!cur) cur = { company: "", role: "", duration: "", location: "", bullets: [] };
      cur.bullets.push(stripBullet(line));
      continue;
    }
    if (DATE_RANGE_RE.test(line)) {
      flush();
      cur = { company: "", role: "", duration: "", location: "", bullets: [] };
      const dateMatch = line.match(DATE_RANGE_RE);
      cur.duration = dateMatch ? dateMatch[0].trim() : "";
      const remainder = line.replace(DATE_RANGE_RE, "").replace(/\s+/g, " ").trim();
      const sep = remainder.split(/\s+[\-–—|·@]\s+|,\s+/).map((s) => s.trim()).filter(Boolean);
      if (sep.length >= 2) {
        const ROLE_HINT = /(engineer|developer|manager|analyst|designer|consultant|lead|architect|scientist|director|specialist|associate|intern|executive|officer|administrator)/i;
        if (ROLE_HINT.test(sep[0])) { cur.role = sep[0]; cur.company = sep[1]; }
        else { cur.company = sep[0]; cur.role = sep[1]; }
      } else if (sep.length === 1) {
        cur.company = sep[0];
      }
      continue;
    }
    if (!cur) {
      cur = { company: line, role: "", duration: "", location: "", bullets: [] };
      continue;
    }
    if (!cur.role && /(engineer|developer|manager|analyst|designer|consultant|lead|architect|scientist|director|specialist|associate|intern|executive|officer|administrator)/i.test(line)) {
      cur.role = line;
    } else if (!cur.location && KNOWN_CITIES.some((c) => new RegExp("\\b" + c + "\\b", "i").test(line))) {
      cur.location = (line.match(new RegExp(KNOWN_CITIES.join("|"), "i")) || [""])[0];
    } else {
      cur.bullets.push(line);
    }
  }
  flush();
  return entries;
}

function parseEducationBlock(block: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  let cur: EducationEntry | null = null;
  const flush = () => { if (cur && (cur.institution || cur.degree)) entries.push(cur); cur = null; };
  const DEGREE_HINT = /(b\.?tech|b\.?e\.?|bachelor|m\.?tech|m\.?e\.?|master|mba|bsc|msc|ba|ma|ph\.?d|diploma|class\s*(?:x|xii|10|12)|hsc|ssc)/i;
  for (const raw of block) {
    const line = raw.trim();
    if (!line) continue;
    if (DEGREE_HINT.test(line) && !cur?.degree) {
      if (!cur) cur = { institution: "", degree: "", year: "", location: "" };
      cur.degree = line;
      continue;
    }
    const yr = line.match(/\b(19|20)\d{2}\b/);
    if (yr && cur && !cur.year) {
      cur.year = yr[0];
      const rest = line.replace(yr[0], "").replace(/[\-–—|,]/g, " ").replace(/\s+/g, " ").trim();
      if (rest && !cur.institution) cur.institution = rest;
      continue;
    }
    const cgpa = line.match(/(?:cgpa|gpa|percentage|aggregate)[^\d]*(\d+(?:\.\d+)?)/i);
    if (cgpa && cur) { cur.cgpa = cgpa[1]; continue; }
    if (!cur) cur = { institution: "", degree: "", year: "", location: "" };
    if (!cur.institution) cur.institution = line;
    else if (!cur.location && KNOWN_CITIES.some((c) => new RegExp("\\b" + c + "\\b", "i").test(line))) {
      cur.location = (line.match(new RegExp(KNOWN_CITIES.join("|"), "i")) || [""])[0];
    } else {
      flush();
      cur = { institution: line, degree: "", year: "", location: "" };
    }
  }
  flush();
  return entries;
}

function parseSkillsBlock(block: string[]): string[] {
  const joined = block.join(", ");
  return joined
    .split(/[,;|·•\n]/)
    .map((s) => s.replace(/^[-–—\s]+/, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 40)
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

function parseProjectsBlock(block: string[]): ProjectEntry[] {
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
    const techMatch = line.match(/^(?:tech(?:nologies)?|stack|tools)\s*[:\-–]\s*(.+)$/i);
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

// pdf-parse v2 inserts a "-- N of M --" page-break marker between pages. Strip it.
const PAGE_MARKER_RE = /^\s*-{1,3}\s*\d+\s+of\s+\d+\s*-{1,3}\s*$/i;

function extractProfile(text: string): ExtractedProfile {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\u00a0/g, " ").trimEnd())
    .filter((l) => !PAGE_MARKER_RE.test(l));
  const buckets: Record<string, string[]> = { summary: [], experience: [], education: [], skills: [], projects: [] };
  let active: string | null = null;
  const headerLines: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    const sec = classifySection(trimmed);
    if (sec) {
      active = (sec in buckets) ? sec : null;
      continue;
    }
    const inline = splitInlineHeader(trimmed);
    if (inline) {
      active = (inline.section in buckets) ? inline.section : null;
      if (active && inline.rest) buckets[active].push(inline.rest);
      continue;
    }
    if (active) {
      buckets[active].push(trimmed);
    } else {
      headerLines.push(trimmed);
    }
  }
  const flat = lines.join("\n");
  const email = extractEmail(flat);
  const phone = extractPhone(flat);
  const city = extractCity(headerLines.slice(0, 12).join("\n") + "\n" + flat);
  const name = extractName(lines, email);
  const summary = buckets.summary.filter(Boolean).join(" ").slice(0, 800) || null;
  const experience = parseExperienceBlock(buckets.experience);
  const education = parseEducationBlock(buckets.education);
  const skills = parseSkillsBlock(buckets.skills);
  const projects = parseProjectsBlock(buckets.projects);
  const graduation_year = extractGraduationYear(flat, buckets.education.join("\n"));
  return { name, email, phone, city, graduation_year, summary, experience, education, skills, projects };
}

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the upload UI

export async function POST(req: NextRequest) {
  let parser: { destroy: () => Promise<void> } | null = null;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Please select a PDF to upload." }, { status: 400 });
    }
    const isPdfMime = file.type === "application/pdf";
    const isPdfName = /\.pdf$/i.test(file.name || "");
    if (!isPdfMime && !isPdfName) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "PDF too large — please upload a file under 5 MB." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // pdf-parse v2 exposes a PDFParse class instead of a callable default export.
    // Use an untyped dynamic import to avoid clashing with stale @types/pdf-parse v1 typings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("pdf-parse")) as any;
    const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
    if (!PDFParse) {
      throw new Error("pdf-parse v2 export missing — check installed version (>=2.x)");
    }
    parser = new PDFParse({ data, verbosity: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (parser as any).getText();
    const text: string = (result?.text ?? "").toString();

    if (!text.trim()) {
      return NextResponse.json({
        error: "We couldn't read any text from this PDF. If it's a scanned/image PDF, please re-export it as a text PDF (File → Save As PDF) and try again.",
        text: "",
        extracted: null,
        partial: true,
      }, { status: 200 });
    }

    const extracted = extractProfile(text);
    return NextResponse.json({ text, extracted });
  } catch (err) {
    console.error("Resume parse error:", err);
    const name = (err as { name?: string } | null)?.name ?? "";
    const message = (err as { message?: string } | null)?.message ?? "";
    if (name === "PasswordException" || /password/i.test(message)) {
      return NextResponse.json({ error: "This PDF is password-protected. Please upload an unlocked copy." }, { status: 200 });
    }
    if (name === "InvalidPDFException" || /invalid pdf/i.test(message)) {
      return NextResponse.json({ error: "This file isn't a valid PDF. Please re-export and try again." }, { status: 200 });
    }
    return NextResponse.json({
      error: "We couldn't parse this PDF. Try re-exporting it as a text PDF, or click \"Skip — fill manually\" to enter your details by hand.",
      extracted: null,
      partial: true,
    }, { status: 200 });
  } finally {
    if (parser) {
      try { await parser.destroy(); } catch { /* ignore */ }
    }
  }
}
