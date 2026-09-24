// Anti-hallucination post-generation validator.
//
// The system prompt has an ANTI-FABRICATION section, but prompts are guidance,
// not guarantees. Production resumes contained metrics that appear nowhere in
// the source profile — "₹8.5 Cr in annual partner-generated revenue",
// "reduce qualification time by 35%", "94% partner satisfaction" — and leaked
// the model's own placeholders into the finished document
// ("Previous Organization", "Institution Name · Bachelor's Degree").
//
// For a paid product aimed at job seekers that is the single biggest risk:
// a candidate walks into an interview defending numbers they never supplied.
//
// So the model's output is treated as untrusted and scrubbed against the
// profile before anything is stored:
//
//   1. Experience whose company is a placeholder or absent from the profile
//      is dropped outright.
//   2. Education whose institution is a placeholder is dropped.
//   3. Bullets containing a number that appears nowhere in the profile are
//      dropped — an unverifiable metric is worse than a missing bullet.
//
// Everything dropped is recorded in `warnings`, which the route logs and
// reports through the generate_resume_sanitised analytics event, so silent
// degradation is visible.

export type SanitiseProfile = {
  summary?: string;
  experience?: Array<{
    company: string;
    role: string;
    duration: string;
    location?: string;
    bullets: string[];
  }>;
  education?: Array<{
    institution: string;
    degree: string;
    year: string;
    location?: string;
    cgpa?: string;
  }>;
  projects?: Array<{ name: string; description: string; tech: string[] }>;
  skills?: string[];
};

export type ResumeShape = {
  experience?: Array<{ company?: string; role?: string; duration?: string; bullets?: string[] }>;
  education?: Array<{ institution?: string; degree?: string; year?: string }>;
  projects?: Array<{ name?: string; description?: string; tech?: string[] }>;
  summary?: string;
  section_order?: string[];
  ats_score?: number;
  growth_note?: string | null;
  [k: string]: unknown;
};

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.\- ]/g, "").trim();
}

const PLACEHOLDER_COMPANY_PATTERNS: RegExp[] = [
  /previous organi[sz]ation/i,
  /^company [a-z]$/i,
  /^employer$/i,
  /^confidential$/i,
  /^n\/a$/i,
  /^various$/i,
  /^self$/i,
  /^freelance$/i,
  /^tbd$/i,
];

const PLACEHOLDER_INSTITUTION_PATTERNS: RegExp[] = [
  /institution name/i,
  /university name/i,
  /college name/i,
  /school name/i,
  /^institution$/i,
  /^university$/i,
  /^college$/i,
  /^n\/a$/i,
  /^tbd$/i,
  /your (university|college|institution)/i,
];

/**
 * Every numeric token appearing anywhere in the user's own profile.
 * "₹8.5 Cr" contributes "8.5"; "35%" contributes "35"; "Jun 2023" contributes
 * "2023". Thousands separators are stripped so "1,200" matches "1200".
 */
export function profileNumbers(profile: SanitiseProfile): Set<string> {
  const parts: string[] = [];
  if (profile.summary) parts.push(profile.summary);
  for (const e of profile.experience ?? []) {
    parts.push(e.company, e.role, e.duration, e.location ?? "", ...e.bullets);
  }
  for (const ed of profile.education ?? []) {
    parts.push(ed.institution, ed.degree, ed.year, ed.location ?? "", ed.cgpa ?? "");
  }
  for (const p of profile.projects ?? []) {
    parts.push(p.name, p.description, ...(p.tech ?? []));
  }
  parts.push(...(profile.skills ?? []));
  return extractNumbers(parts.join(" "));
}

/**
 * Word-overlap similarity used to find the candidate's own bullet a rewritten
 * bullet came from (shared words / size of the smaller bullet).
 */
function bulletSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(" ").filter((w) => w.length > 2));
  const wa = words(a), wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(1, Math.min(wa.size, wb.size));
}

/** Numeric tokens in a blob of text, with thousands separators removed. */
export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const m of cleaned.matchAll(/\d+(?:\.\d+)?/g)) {
    out.add(m[0].replace(/\.0+$/, ""));
  }
  return out;
}

/**
 * Numbers in `text` that do not appear in `allowed`.
 *
 * Ordinals and small counts that are part of ordinary prose ("3-person team"
 * is a claim; "24/7" or "Top 10" are not metrics about the candidate) are NOT
 * special-cased — if a number is not traceable to the profile, the bullet
 * asserting it cannot be verified and is dropped.
 */
export function unverifiableNumbers(text: string, allowed: Set<string>): string[] {
  return [...extractNumbers(text)].filter((n) => !allowed.has(n));
}

/**
 * The four fields app/(app)/create/page.tsx writes straight into typed columns
 * on public.resumes:
 *
 *   ats_score, tailored_role, matched_keywords, missing_keywords
 *
 * If the model omits any of them the client passes `undefined`, JSON.stringify
 * drops the key, and the row lands with NULLs. The damage is silent and
 * downstream: the dashboard renders `ats_score ?? 0` as a red "0", and the
 * preview's score ring divides null by 100 and draws an empty dial. The user
 * sees a resume that looks like it scored nothing.
 *
 * `repaired` lists fields we could safely default — labels and lists, where an
 * empty value asserts nothing about the candidate.
 *
 * `fatal` lists fields we cannot default honestly. Only ats_score qualifies:
 * there is no truthful number to substitute, and inventing one is exactly the
 * behaviour the rest of this module exists to prevent. The caller treats a
 * fatal problem as a failed generation — which costs the user a retry and no
 * credit, rather than persisting a resume that appears to have scored zero.
 *
 * ats_score is fatal when it is missing, non-numeric, blank/whitespace, NaN,
 * infinite, OR outside 0..100. Out-of-range values are NOT clamped: clamping
 * -5 to 0 produces the same misleading zero as a blank score, and clamping
 * 142 to 100 manufactures a perfect result the model never claimed. In-range
 * decimals are rounded normally.
 */
export function normaliseGeneratedResume(
  resume: ResumeShape,
  fallbackRole: string
): { resume: ResumeShape; repaired: string[]; fatal: string[] } {
  const repaired: string[] = [];
  const fatal: string[] = [];

  const asStringArray = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

  for (const key of ["matched_keywords", "missing_keywords"] as const) {
    const arr = asStringArray(resume[key]);
    if (arr === null) {
      resume[key] = [];
      repaired.push(key);
    } else {
      resume[key] = arr;
    }
  }

  if (typeof resume.tailored_role !== "string" || !resume.tailored_role.trim()) {
    resume.tailored_role = fallbackRole.trim() || "Resume";
    repaired.push("tailored_role");
  }

  // Accept a numeric string ("78") — models emit them — but nothing else.
  //
  // The blank-string case has to be rejected explicitly. Number("") and
  // Number("   ") are both 0, and 0 is finite, so a naive coercion would
  // silently turn "no score" into a legitimate-looking score of zero — the
  // exact misleading red "0" this function exists to prevent. Only a string
  // with non-whitespace content is a candidate for coercion.
  // Read as unknown: ResumeShape declares ats_score as a number, but this is
  // the trust boundary — the value came from a language model and can be any
  // JSON type, including a blank string.
  const rawScore: unknown = resume.ats_score;
  let score: number | null = null;
  if (typeof rawScore === "number") {
    score = rawScore;
  } else if (typeof rawScore === "string" && rawScore.trim() !== "") {
    score = Number(rawScore.trim());
  }

  if (score === null || !Number.isFinite(score)) {
    // Covers: missing, null, booleans, objects, arrays, "", "   ", "abc",
    // "NaN", "Infinity", and the NaN / ±Infinity numbers themselves.
    fatal.push("ats_score");
  } else if (score < 0 || score > 100) {
    // Out of contract. Previously these were clamped, but clamping -5 to 0
    // produces the same misleading red "0" as a blank score, and clamping 142
    // to 100 silently manufactures a perfect result the model never claimed.
    // A score outside 0..100 means the model ignored the output contract, so
    // the whole response is suspect — fail before the credit is spent rather
    // than repair a number we have no basis to trust.
    //
    // The range is checked on the RAW value, before rounding, so the boundary
    // is consistent: 100.4 and 100.6 are both violations rather than one
    // rounding quietly back into range and the other failing.
    fatal.push("ats_score");
  } else {
    // In range: round normally. 78.6 -> 79, 78.4 -> 78.
    resume.ats_score = Math.round(score);
  }

  return { resume, repaired, fatal };
}

export function sanitiseGeneratedResume(
  resume: ResumeShape,
  profile: SanitiseProfile
): { resume: ResumeShape; warnings: string[] } {
  const warnings: string[] = [];
  const profileCompanies = new Set(
    (profile.experience ?? []).map((e) => norm(e.company))
  );
  const allowedNumbers = profileNumbers(profile);

  // ── Experience ──────────────────────────────────────────────────────────
  if (Array.isArray(resume.experience)) {
    const cleaned = resume.experience.filter((exp) => {
      const c = (exp.company ?? "").trim();
      if (!c) {
        warnings.push("dropped_experience_missing_company");
        return false;
      }
      if (PLACEHOLDER_COMPANY_PATTERNS.some((re) => re.test(c))) {
        warnings.push(`dropped_placeholder_company:${c}`);
        return false;
      }
      if (profileCompanies.size > 0 && !profileCompanies.has(norm(c))) {
        warnings.push(`dropped_fabricated_company:${c}`);
        return false;
      }
      return true;
    });

    // Numbers in a bullet must come from THE SAME ROLE — its own bullets and
    // dates — not from anywhere in the profile. Profile-wide grounding let a
    // QA bullet borrow "5" from another job's "Containerised 5 services"
    // (live eval S10). An offending bullet reverts to the candidate's own
    // bullet it was rewritten from, so an invented metric costs the flourish,
    // not the truthful accomplishment; it is dropped only when no source
    // bullet can be identified.
    for (const exp of cleaned) {
      if (!Array.isArray(exp.bullets)) continue;
      const src =
        (profile.experience ?? []).find((p) => norm(p.company) === norm(exp.company ?? "") && norm(p.role) === norm(exp.role ?? "")) ??
        (profile.experience ?? []).find((p) => norm(p.company) === norm(exp.company ?? ""));
      const roleNumbers = src
        ? extractNumbers([src.duration, src.role, ...src.bullets].join(" "))
        : allowedNumbers;
      const out: string[] = [];
      for (const b of exp.bullets) {
        const bad = unverifiableNumbers(b, roleNumbers);
        if (bad.length === 0) {
          out.push(b);
          continue;
        }
        const best = (src?.bullets ?? [])
          .map((sb) => ({ sb, score: bulletSimilarity(b, sb) }))
          .sort((x, y) => y.score - x.score)[0];
        if (best && best.score >= 0.3) {
          warnings.push(`reverted_bullet_unverifiable_metric:${bad.join("/")}`);
          out.push(best.sb);
        } else {
          warnings.push(`dropped_bullet_unverifiable_metric:${bad.join("/")}`);
        }
      }
      exp.bullets = [...new Set(out)];
    }

    resume.experience = cleaned;

    // If we just emptied the array, drop the key entirely and switch to fresher order.
    if (cleaned.length === 0) {
      delete resume.experience;
      if (Array.isArray(resume.section_order)) {
        resume.section_order = resume.section_order.filter((sec) => sec !== "experience");
        if (!resume.section_order.includes("education")) resume.section_order.unshift("education");
      }
      if (typeof resume.ats_score === "number" && resume.ats_score > 65) {
        resume.ats_score = 65;
      }
      if (!resume.growth_note) {
        resume.growth_note = "Profile currently shows no verified work experience; resume leads with education and projects.";
      }
    }
  }

  // ── Education ───────────────────────────────────────────────────────────
  // "Institution Name · Bachelor's Degree" reached a finished document.
  if (Array.isArray(resume.education)) {
    const cleanedEdu = resume.education.filter((ed) => {
      const inst = (ed.institution ?? "").trim();
      if (!inst) {
        warnings.push("dropped_education_missing_institution");
        return false;
      }
      if (PLACEHOLDER_INSTITUTION_PATTERNS.some((re) => re.test(inst))) {
        warnings.push(`dropped_placeholder_institution:${inst}`);
        return false;
      }
      return true;
    });
    if (cleanedEdu.length === 0) {
      delete resume.education;
      if (Array.isArray(resume.section_order)) {
        resume.section_order = resume.section_order.filter((s) => s !== "education");
      }
    } else {
      resume.education = cleanedEdu;
    }
  }

  // ── Projects ────────────────────────────────────────────────────────────
  // Same metric rule as experience bullets.
  // Numbers must come from THIS project's own description and tech.
  if (Array.isArray(resume.projects)) {
    for (const p of resume.projects) {
      if (typeof p.description !== "string") continue;
      const source = (profile.projects ?? []).find((sp) => {
        const a = norm(sp.name), b = norm(p.name ?? "");
        return a === b || a.startsWith(b) || b.startsWith(a);
      });
      const projectNumbers = source
        ? extractNumbers([source.name, source.description, ...(source.tech ?? [])].join(" "))
        : allowedNumbers;
      const bad = unverifiableNumbers(p.description, projectNumbers);
      if (bad.length > 0) {
        warnings.push(`stripped_project_metric:${bad.join("/")}`);
        // A project's description is its only prose — blanking it would leave
        // an empty card, so fall back to the user's own text where we have it.
        p.description = source?.description ?? "";
      }
    }
  }

  return { resume, warnings };
}
