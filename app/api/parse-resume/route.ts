import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────

function extractEmail(text: string): string {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : "";
}

function extractPhone(text: string): string {
  const m = text.match(/(?:\+91[\s\-]?)?(?:\(?[0-9]{3,5}\)?[\s\-]?)?[0-9]{4,5}[\s\-]?[0-9]{4,5}/);
  return m ? m[0].trim() : "";
}

function extractName(lines: string[]): string {
  for (const line of lines.slice(0, 8)) {
    const l = line.trim();
    if (!l) continue;
    if (l.match(/[@http:\/\/www\.]/)) continue;
    if (l.match(/^\+?[\d\s\-()]{7,}$/)) continue;
    if (l.match(/^(resume|curriculum vitae|cv)$/i)) continue;
    if (l.length > 5 && l.length < 60) return l;
  }
  return "";
}

function extractCity(text: string): string {
  const cities = [
    "Mumbai","Delhi","Bangalore","Bengaluru","Hyderabad","Chennai","Kolkata",
    "Pune","Ahmedabad","Jaipur","Surat","Lucknow","Kanpur","Nagpur","Indore",
    "Thane","Bhopal","Visakhapatnam","Patna","Vadodara","Ghaziabad",
    "Ludhiana","Agra","Nashik","Faridabad","Meerut","Rajkot",
    "Varanasi","Srinagar","Aurangabad","Amritsar","Allahabad","Ranchi",
    "Howrah","Coimbatore","Jabalpur","Gwalior","Vijayawada","Jodhpur","Madurai",
    "Raipur","Kochi","Chandigarh","Gurgaon","Gurugram","Noida","Navi Mumbai",
    "Mysore","Mysuru","Mangalore","Hubli","Belgaum","Belagavi",
    "Tiruchirappalli","Trichy","Salem","Erode","Vellore",
    "Warangal","Guntur","Nellore","Kurnool","Rajahmundry","Tirupati",
    "Bhubaneswar","Cuttack","Guwahati","Dehradun","Shimla","Jammu",
    "Thiruvananthapuram","Thrissur","Kozhikode","Calicut","Kollam",
    "Pondicherry","Puducherry",
    "New York","San Francisco","London","Singapore","Dubai","Toronto","Sydney",
    "Berlin","Amsterdam","Paris","Tokyo","Hong Kong",
  ];
  for (const city of cities) {
    const re = new RegExp(`\\b${city}\\b`, "i");
    if (re.test(text)) return city;
  }
  const m = text.match(/\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?),?\s*(?:[A-Z]{2}|India|Karnataka|Maharashtra|Tamil Nadu|Telangana|Andhra Pradesh|Kerala|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|West Bengal|Odisha|Assam|Jharkhand|Bihar|Madhya Pradesh|Chhattisgarh|Uttarakhand|Himachal Pradesh|Goa|Jammu)\b/);
  if (m) return m[1];
  return "";
}

function splitIntoSections(text: string): Record<string, string> {
  const SECTION_HEADERS = [
    { key: "summary",    re: /^(summary|professional summary|profile|objective|about me|career objective)\s*$/im },
    { key: "experience", re: /^(experience|work experience|employment|work history|professional experience|internship|internships|career history)\s*$/im },
    { key: "education",  re: /^(education|academic background|qualifications|academic qualifications|educational background)\s*$/im },
    { key: "skills",     re: /^(skills|technical skills|core competencies|key skills|technologies|tools|expertise|competencies)\s*$/im },
    { key: "projects",   re: /^(projects|personal projects|academic projects|key projects|notable projects|side projects)\s*$/im },
  ];

  const lines = text.split("\n");
  const sectionStarts: Array<{ key: string; lineIdx: number }> = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    for (const { key, re } of SECTION_HEADERS) {
      if (re.test(trimmed)) {
        sectionStarts.push({ key, lineIdx: idx });
        break;
      }
    }
  });

  const sections: Record<string, string> = { header: "" };
  if (sectionStarts.length === 0) { sections.header = text; return sections; }

  sections.header = lines.slice(0, sectionStarts[0].lineIdx).join("\n");
  for (let i = 0; i < sectionStarts.length; i++) {
    const { key, lineIdx } = sectionStarts[i];
    const endLine = i + 1 < sectionStarts.length ? sectionStarts[i + 1].lineIdx : lines.length;
    sections[key] = lines.slice(lineIdx + 1, endLine).join("\n");
  }
  return sections;
}

function parseExperience(text: string): ExperienceEntry[] {
  if (!text.trim()) return [];
  const entries: ExperienceEntry[] = [];
  const DURATION_RE = /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}\s*(?:–|-|to)\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}\s*(?:–|-|to)\s*(?:Present|Current|Now|Till Date|Ongoing)/gi;

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let current: ExperienceEntry | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const durationMatch = line.match(DURATION_RE);

    if (durationMatch) {
      if (current) entries.push(current);
      const duration = durationMatch[0];
      const prevLine = i > 0 ? lines[i - 1] : "";
      const nextLine = i < lines.length - 1 ? lines[i + 1] : "";

      let company = "";
      let role = "";
      let location = "";

      const sameLineRest = line.replace(DURATION_RE, "").replace(/[|,·•]/g, " ").trim();
      if (sameLineRest.length > 3) {
        const parts = sameLineRest.split(/\s{2,}|[|,·•]/);
        company = parts[0]?.trim() || "";
        role = parts[1]?.trim() || "";
      }
      if (!company && prevLine && !prevLine.match(DURATION_RE)) {
        company = prevLine.replace(/[|,·•]/g, " ").trim();
      }
      if (!role && nextLine && !nextLine.match(/^[•\-*]/) && !nextLine.match(DURATION_RE)) {
        role = nextLine.trim();
        i++;
      }
      const cityMatch = (company + " " + role).match(/,\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*$/);
      if (cityMatch) { location = cityMatch[1]; company = company.replace(cityMatch[0], "").trim(); }

      current = { company, role, duration, location, bullets: [] };
    } else if (current && (line.startsWith("•") || line.startsWith("-") || line.startsWith("*") || line.startsWith("–"))) {
      current.bullets.push(line.replace(/^[•\-*–]\s*/, "").trim());
    } else if (current && line.length > 20 && !line.match(/^[A-Z\s]{3,}$/) && current.bullets.length > 0) {
      current.bullets.push(line);
    }
  }
  if (current) entries.push(current);
  return entries.filter(e => e.company.length > 1 || e.role.length > 1);
}

function parseEducation(text: string): EducationEntry[] {
  if (!text.trim()) return [];
  const entries: EducationEntry[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const DEGREE_KEYWORDS = /\b(b\.?tech|m\.?tech|b\.?e|m\.?e|b\.?sc|m\.?sc|b\.?com|m\.?com|b\.?a|m\.?a|mba|bba|phd|ph\.d|diploma|bachelor|master|associate|hsc|ssc|10th|12th|intermediate|secondary|higher secondary|b\.?ca|m\.?ca|b\.?des|m\.?des|llb|llm)\b/i;
  const YEAR_RE = /\b(19|20)\d{2}\b/g;
  const CGPA_RE = /(?:cgpa|gpa|percentage|%|score)[:\s]*([0-9.]+\s*(?:\/\s*[0-9.]+)?)/i;

  let current: EducationEntry | null = null;

  for (const line of lines) {
    const hasDegree = DEGREE_KEYWORDS.test(line);
    const years = line.match(YEAR_RE);
    const cgpaMatch = line.match(CGPA_RE);

    if (hasDegree || (years && years.length >= 1 && line.length < 120)) {
      if (current) entries.push(current);
      const year = years ? (years.length >= 2 ? `${years[0]}\u2013${years[years.length - 1]}` : years[0]) : "";
      const cgpa = cgpaMatch ? cgpaMatch[1].trim() : "";
      let institution = "";
      let degree = "";
      const parts = line.split(/[,|·•\t]/).map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (DEGREE_KEYWORDS.test(part) && !degree) {
          degree = part.replace(YEAR_RE, "").replace(CGPA_RE, "").trim();
        } else if (!institution && !part.match(YEAR_RE) && !part.match(CGPA_RE)) {
          institution = part;
        }
      }
      if (!degree) degree = line.replace(YEAR_RE, "").replace(CGPA_RE, "").replace(institution, "").trim();
      current = { institution, degree, year, location: "", cgpa };
    } else if (current && !current.institution && line.length > 3 && line.length < 100) {
      current.institution = line;
    } else if (current && cgpaMatch && !current.cgpa) {
      current.cgpa = cgpaMatch[1].trim();
    }
  }
  if (current) entries.push(current);
  return entries.filter(e => e.institution.length > 1 || e.degree.length > 1);
}

function parseSkills(text: string): string[] {
  if (!text.trim()) return [];
  const skills: string[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line.replace(/^[A-Za-z\s]+:\s*/, "");
    const parts = cleaned.split(/[,|•\-\/·]+/).map(s => s.trim()).filter(s => s.length > 1 && s.length < 40);
    skills.push(...parts);
  }
  return [...new Set(skills)];
}

function parseProjects(text: string): ProjectEntry[] {
  if (!text.trim()) return [];
  const projects: ProjectEntry[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let current: ProjectEntry | null = null;

  for (const line of lines) {
    const isBullet = line.startsWith("•") || line.startsWith("-") || line.startsWith("*");
    const looksLikeTitle = !isBullet && line.length < 80 && !line.match(/^[a-z]/) && line.length > 3;
    if (looksLikeTitle && !line.match(/^(tech|technologies|tools|stack)[:\s]/i)) {
      if (current) projects.push(current);
      current = { name: line, description: "", tech: [] };
    } else if (current) {
      const techMatch = line.match(/(?:tech|technologies|tools|stack|built with)[:\s]+(.+)/i);
      if (techMatch) {
        current.tech = techMatch[1].split(/[,|·]/).map(t => t.trim()).filter(Boolean);
      } else if (isBullet) {
        const desc = line.replace(/^[•\-*]\s*/, "").trim();
        current.description = current.description ? current.description + " " + desc : desc;
      } else if (line.length > 10) {
        current.description = current.description ? current.description + " " + line : line;
      }
    }
  }
  if (current) projects.push(current);
  return projects.filter(p => p.name.length > 1);
}

function extractGraduationYear(education: EducationEntry[], text: string): number | null {
  const years: number[] = [];
  for (const edu of education) {
    const matches = edu.year.match(/\b(19|20)\d{2}\b/g);
    if (matches) years.push(...matches.map(Number));
  }
  const degreeYearRe = /(?:b\.?tech|m\.?tech|b\.?e|m\.?e|bachelor|master|mba|bba|diploma|b\.?sc|m\.?sc)[^.]*?\b((19|20)\d{2})\b/gi;
  let m;
  while ((m = degreeYearRe.exec(text)) !== null) years.push(parseInt(m[1]));
  if (years.length === 0) return null;
  return Math.max(...years);
}

// ── Main handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF file required" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (await import("pdf-parse")) as any;
    const { text } = await pdfParse.default(buffer);

    if (!text?.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from this PDF. Try a different file." },
        { status: 422 }
      );
    }

    // ── Rule-based extraction ──────────────────────────────────────────────
    const sections = splitIntoSections(text);
    const headerText = sections.header || text.slice(0, 800);
    const headerLines = headerText.split("\n").map((l: string) => l.trim()).filter(Boolean);

    const experience = parseExperience(sections.experience || "");
    const education  = parseEducation(sections.education || "");
    const skills     = parseSkills(sections.skills || "");
    const projects   = parseProjects(sections.projects || "");

    const extracted: ExtractedProfile = {
      name:            extractName(headerLines),
      email:           extractEmail(headerText),
      phone:           extractPhone(headerText),
      city:            extractCity(text),
      graduation_year: extractGraduationYear(education, text),
      summary:         sections.summary?.trim() || null,
      experience,
      education,
      skills,
      projects,
    };

    const hasContent = experience.length > 0 || education.length > 0 || skills.length > 0;

    return NextResponse.json({ text, extracted, partial: !hasContent });
  } catch (err) {
    console.error("Resume parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse resume. Please try again." },
      { status: 500 }
    );
  }
}
