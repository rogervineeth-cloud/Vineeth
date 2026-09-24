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

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function analyzeJd(text: string): JdAnalysis {
    if (text.length < 100) {
          return { detectedRole: null, keywords: [], quality: "weak" };
    }
    const seen = new Set<string>();
    const found: string[] = [];
    for (const p of TECH_SKILL_PATTERNS) {
          const re = new RegExp(
                  `(?<![${SKILL_BOUNDARY_CHARS}])${escapeRegex(p.pattern)}(?![${SKILL_BOUNDARY_CHARS}])`,
                  "i"
                );
          if (re.test(text) && !seen.has(p.canonical)) {
                  seen.add(p.canonical);
                  found.push(p.canonical);
          }
    }
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
