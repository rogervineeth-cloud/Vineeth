// JD keyword extraction used by the create page to propose the keywords a
// candidate curates before generation. Moved verbatim from
// app/(app)/create/page.tsx so the resume-quality eval harness runs exactly
// what the browser runs.

export type JdAnalysis = {
  detectedRole: string | null;
  keywords: string[];
  quality: "weak" | "ok" | "good";
};

// Each entry is the canonical skill name. `aliases` are alternative
// spellings/synonyms users commonly write in JDs (case-insensitive).
// Match logic uses a custom boundary so short tokens like "Go" do NOT
// match inside "go-to-market", and so hyphens/dots inside identifiers
// (e.g. "Node.js", "C++", "A/B testing") are preserved correctly.
export const TECH_SKILLS: { name: string; aliases?: string[] }[] = [
    // Languages & runtimes
  { name: "JavaScript", aliases: ["JS", "ES6", "ECMAScript"] },
  { name: "TypeScript", aliases: ["TS"] },
  { name: "Python" },
  { name: "Java" },
  { name: "Kotlin" },
  { name: "Swift" },
  { name: "Objective-C" },
  { name: "Go", aliases: ["Golang"] },
  { name: "Rust" },
  { name: "C++" },
  { name: "C#" },
  { name: "Ruby" },
  { name: "PHP" },
  { name: "Scala" },
    // Web / frontend
  { name: "React", aliases: ["React.js", "ReactJS"] },
  { name: "Next.js", aliases: ["NextJS"] },
  { name: "Angular" },
  { name: "Vue.js", aliases: ["Vue", "VueJS"] },
  { name: "Node.js", aliases: ["NodeJS"] },
  { name: "HTML" },
  { name: "CSS" },
  { name: "Tailwind", aliases: ["TailwindCSS", "Tailwind CSS"] },
    // Mobile
  { name: "iOS", aliases: ["iPhone", "iPadOS"] },
  { name: "Android" },
  { name: "React Native" },
  { name: "Flutter" },
    // Backend / APIs
  { name: "GraphQL" },
  { name: "REST API", aliases: ["REST", "RESTful API", "RESTful"] },
  { name: "gRPC" },
  { name: "Spring Boot" },
  { name: "Django" },
  { name: "FastAPI" },
  { name: "Flask" },
  { name: "Express", aliases: ["Express.js"] },
  { name: "Microservices", aliases: ["Microservice"] },
    // CS fundamentals & engineering practice — the core of most SWE/SDE
    // postings (Google, Amazon, ...). Without these the candidate's truthful
    // DSA / code-review / design evidence was never proposed for curation.
  { name: "Data Structures", aliases: ["Data Structure", "DSA"] },
  { name: "Algorithms", aliases: ["Algorithm"] },
  { name: "System Design", aliases: ["Systems Design"] },
  { name: "Distributed Systems", aliases: ["Distributed System", "Distributed Computing"] },
  { name: "Object-Oriented Design", aliases: ["Object Oriented Design", "Object-Oriented Programming", "Object Oriented Programming", "OOP", "OOPS"] },
  { name: "Design Patterns", aliases: ["Design Pattern"] },
  { name: "Code Review", aliases: ["Code Reviews", "Review code", "Reviewed code"] },
  { name: "Unit Testing", aliases: ["Unit Tests", "Unit Test"] },
  { name: "Accessibility", aliases: ["A11y", "WCAG", "Accessible technologies"] },
    // Cloud & infra
  { name: "AWS", aliases: ["Amazon Web Services"] },
  { name: "Azure", aliases: ["Microsoft Azure"] },
  { name: "GCP", aliases: ["Google Cloud", "Google Cloud Platform"] },
  { name: "Docker" },
  { name: "Kubernetes", aliases: ["K8s"] },
  { name: "Terraform" },
  { name: "CI/CD", aliases: ["Continuous Integration", "Continuous Delivery", "Continuous Deployment"] },
  { name: "Linux" },
  { name: "Git" },
    // Data
  { name: "SQL" },
  { name: "PostgreSQL", aliases: ["Postgres"] },
  { name: "MySQL" },
  { name: "MongoDB" },
  { name: "Redis" },
  { name: "Kafka" },
  { name: "Elasticsearch", aliases: ["Elastic Search", "ELK"] },
  { name: "Firebase" },
  { name: "Snowflake" },
  { name: "BigQuery" },
  { name: "Airflow" },
    // Analytics & BI
  { name: "Excel" },
  { name: "Power BI" },
  { name: "Tableau" },
  { name: "Looker" },
  { name: "Mixpanel" },
  { name: "Amplitude" },
  { name: "Google Analytics", aliases: ["GA4"] },
  { name: "SQL Server" },
    // ML / AI
  { name: "Machine Learning", aliases: ["ML"] },
  { name: "Deep Learning" },
  { name: "TensorFlow" },
  { name: "PyTorch" },
  { name: "NLP", aliases: ["Natural Language Processing"] },
  { name: "Computer Vision" },
  { name: "LLM", aliases: ["Large Language Model", "Large Language Models", "GPT"] },
  { name: "Data Analysis" },
    // Process & ways of working
  { name: "Agile" },
  { name: "Scrum" },
  { name: "Kanban" },
    // Product & design
  { name: "Product Management" },
  { name: "Product Strategy" },
  { name: "Roadmapping", aliases: ["Roadmap"] },
  { name: "A/B Testing", aliases: ["AB Testing", "Experimentation", "Split Testing"] },
  { name: "User Research" },
  { name: "Stakeholder Management" },
  { name: "Go-to-Market", aliases: ["GTM"] },
  { name: "OKRs" },
  { name: "Figma" },
  { name: "Sketch" },
  { name: "UI/UX", aliases: ["UX", "UI"] },
    // Enterprise / SaaS
  { name: "Salesforce" },
  { name: "SAP" },
  { name: "JIRA" },
  { name: "Confluence" },
  { name: "Notion" },
  { name: "Slack" },
    // Marketing
  { name: "SEO" },
  { name: "SEM" },
  { name: "Performance Marketing" },
    // Other / misc
  { name: "Technical Writing" },
  ];

// Build a flat list of patterns we test against the JD text. Map each
// match back to the canonical skill name so aliases collapse correctly.
const TECH_SKILL_PATTERNS: { canonical: string; pattern: string }[] = (() => {
    const out: { canonical: string; pattern: string }[] = [];
    for (const s of TECH_SKILLS) {
          out.push({ canonical: s.name, pattern: s.name });
          for (const a of s.aliases ?? []) out.push({ canonical: s.name, pattern: a });
    }
    return out;
})();

// Custom word boundary: a "tech token" can include letters, digits,
// `+`, `#`, `.`, `/`, and `-`. We refuse to match if the character
// immediately before/after the candidate is one of those — this stops
// "Go" from matching inside "go-to-market" while still letting
// "Node.js", "C++", "A/B Testing", "CI/CD" match correctly.
const SKILL_BOUNDARY_CHARS = "A-Za-z0-9+#./\\-";
// As above minus ".", which is handled separately (see detectTechSkills).
const TRAILING_BOUNDARY_CHARS = "A-Za-z0-9+#/\\-";

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Skill names that are also ordinary English words. Matched only in their
// capitalised form ("Go", "Swift"), never as "go live", "express interest",
// "a swift response" or "excel at". Case-insensitive matching turned prose
// into skills — on a JD that is noise; on a candidate's bullet (see
// buildGenerationPayload) it would tell the model to claim a skill the
// candidate does not have.
// Upper-case acronyms are case-sensitive for the same reason: "Oops, the
// build failed" is not object-oriented programming.
const CASE_SENSITIVE_SURFACES = new Set([
  "Go", "Swift", "Rust", "Excel", "Slack", "Notion", "Sketch", "Express", "Looker", "Amplitude",
  "OOP", "OOPS", "DSA",
]);
// Surfaces that are prose when followed by these words, even when matched.
const FOLLOWED_BY_PROSE: Record<string, RegExp> = {
  Excel: /^\s+(at|in)\b/i, // "Excel at stakeholder communication"
  "Review code": /^\s+of\s+conduct\b/i, // "Review code of conduct"
  "Reviewed code": /^\s+of\s+conduct\b/i,
};

/**
 * Canonical TECH_SKILLS names mentioned in `text`, in list order. Aliases
 * collapse to the canonical name ("ReactJS" → "React", "RESTful" → "REST API").
 */
export function detectTechSkills(text: string): string[] {
    const seen = new Set<string>();
    const found: string[] = [];
    for (const p of TECH_SKILL_PATTERNS) {
          if (seen.has(p.canonical)) continue;
          const caseSensitive = CASE_SENSITIVE_SURFACES.has(p.pattern);
          const prose = FOLLOWED_BY_PROSE[p.pattern];
          // Trailing boundary: "." belongs to the token only when a letter or
          // digit follows ("Node.js", "React.js"). At the end of a sentence it
          // is punctuation — otherwise "...data structures or algorithms." and
          // "...experience with Java." never matched.
          const re = new RegExp(
                  `(?<![${SKILL_BOUNDARY_CHARS}])${escapeRegex(p.pattern)}(?![${TRAILING_BOUNDARY_CHARS}]|\\.[A-Za-z0-9])`,
                  caseSensitive ? "g" : "gi"
                );
          let hit = false;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
                  if (prose && prose.test(text.slice(m.index + m[0].length))) continue;
                  hit = true;
                  break;
          }
          if (hit) {
                  seen.add(p.canonical);
                  found.push(p.canonical);
          }
    }
    return found;
}

export function analyzeJd(text: string): JdAnalysis {
    if (text.length < 100) {
          return { detectedRole: null, keywords: [], quality: "weak" };
    }
    const found = detectTechSkills(text);
    const roleMatch = text.match(
          /(?:role|position|title)[:\s]+([A-Za-z][A-Za-z\s]+(?:Engineer|Developer|Manager|Analyst|Designer|Consultant|Lead|Specialist|Associate|Executive|Director|Architect))/i
        );
    const detectedRole = roleMatch ? roleMatch[1].trim().slice(0, 40) : null;
    // Quality is now driven both by length AND signal density: a long JD
    // with no recognized skills is still treated as "weak" so we surface
    // a warning to the user instead of a falsely-confident green tick.
    let quality: JdAnalysis["quality"];
    if (text.length < 300 || found.length < 2) quality = "weak";
    else if (text.length < 800 || found.length < 5) quality = "ok";
    else quality = "good";
    return { detectedRole, keywords: found.slice(0, 12), quality };
}
