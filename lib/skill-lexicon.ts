// Canonical skill vocabulary for the free ATS review.
//
// Deterministic data only — no network, no model. This file exists because
// statistical keyword extraction produced advice a candidate could not act on:
// a JD would yield "react typescript", "aws docker", "docker kubernetes" and
// "software engineer." as "missing keywords", which are adjacent word pairs
// and sentence fragments rather than skills.
//
// A curated vocabulary turns that into "TypeScript, Kubernetes, JUnit, Agile".
//
// Design rules, deliberately conservative:
//
//   * CANONICAL is what we show the candidate, cased the way the industry
//     writes it ("PostgreSQL", not "postgresql").
//   * Aliases only where the two really are the same skill. "Scrum" is NOT an
//     alias of "Agile" — you can run Scrum without being Agile and vice versa,
//     and conflating them would tell a candidate they already have something
//     they do not.
//   * No one- or two-letter aliases. "R", "C", "Go", "ML", "AI" collide with
//     ordinary English and would fire on prose. Where a language needs
//     covering we use the unambiguous spelling ("Golang") and accept a miss
//     rather than risk a false claim.
//   * Multi-word entries are listed explicitly. That is the whole point — a
//     multi-word term is only a skill if it appears here, never because two
//     words happened to sit next to each other.

export type SkillEntry = {
  /** Display form, shown to the candidate. */
  canonical: string;
  /** Lowercase surface forms that mean the same skill. Canonical is implied. */
  aliases?: string[];
};

export const SKILL_LEXICON: SkillEntry[] = [
  // ── Languages ──────────────────────────────────────────────────────────
  { canonical: "Java" },
  { canonical: "JavaScript", aliases: ["js", "ecmascript"] },
  { canonical: "TypeScript", aliases: ["ts"] },
  { canonical: "Python" },
  { canonical: "Golang", aliases: ["go lang", "golang"] },
  { canonical: "C++", aliases: ["cpp"] },
  { canonical: "C#", aliases: ["c sharp", "csharp"] },
  { canonical: "PHP" },
  { canonical: "Ruby" },
  { canonical: "Kotlin" },
  { canonical: "Swift" },
  { canonical: "Scala" },
  { canonical: "Rust" },
  { canonical: "SQL" },
  { canonical: "HTML" },
  { canonical: "CSS" },

  // ── Frameworks & libraries ─────────────────────────────────────────────
  { canonical: "Spring Boot", aliases: ["springboot"] },
  { canonical: "Spring Framework", aliases: ["spring mvc"] },
  { canonical: "React", aliases: ["react.js", "reactjs"] },
  { canonical: "Angular", aliases: ["angular.js", "angularjs"] },
  { canonical: "Vue.js", aliases: ["vue", "vuejs"] },
  { canonical: "Next.js", aliases: ["nextjs"] },
  { canonical: "Node.js", aliases: ["node", "nodejs"] },
  { canonical: "Express.js", aliases: ["express", "expressjs"] },
  { canonical: "Django" },
  { canonical: "Flask" },
  { canonical: "FastAPI" },
  { canonical: ".NET", aliases: ["dotnet", "asp.net"] },
  { canonical: "Hibernate" },
  { canonical: "jQuery" },
  { canonical: "Tailwind CSS", aliases: ["tailwind", "tailwindcss"] },

  // ── Architecture & APIs ────────────────────────────────────────────────
  // "rest" alone is deliberately NOT an alias — "a well-earned rest" would
  // credit the candidate with REST API experience.
  { canonical: "REST API", aliases: ["rest apis", "restful api", "restful apis", "rest service", "rest services"] },
  { canonical: "GraphQL" },
  { canonical: "gRPC" },
  { canonical: "Microservices", aliases: ["microservice", "micro services"] },
  { canonical: "Event-Driven Architecture", aliases: ["event driven architecture"] },
  { canonical: "System Design" },

  // ── Cloud & infrastructure ─────────────────────────────────────────────
  { canonical: "AWS", aliases: ["amazon web services"] },
  { canonical: "Azure", aliases: ["microsoft azure"] },
  { canonical: "GCP", aliases: ["google cloud", "google cloud platform"] },
  { canonical: "Docker" },
  { canonical: "Kubernetes", aliases: ["k8s"] },
  { canonical: "Terraform" },
  { canonical: "Jenkins" },
  { canonical: "CI/CD", aliases: ["ci cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"] },
  { canonical: "Linux" },
  { canonical: "Nginx" },
  { canonical: "Kafka", aliases: ["apache kafka"] },
  { canonical: "RabbitMQ" },
  { canonical: "Redis" },
  { canonical: "Elasticsearch" },

  // ── Data stores ────────────────────────────────────────────────────────
  { canonical: "PostgreSQL", aliases: ["postgres", "postgre sql"] },
  { canonical: "MySQL" },
  { canonical: "MongoDB", aliases: ["mongo"] },
  { canonical: "Oracle" },
  { canonical: "DynamoDB" },
  { canonical: "Snowflake" },

  // ── Testing & quality ──────────────────────────────────────────────────
  { canonical: "JUnit" },
  { canonical: "Jest" },
  { canonical: "Selenium" },
  { canonical: "Cypress" },
  { canonical: "Unit Testing", aliases: ["unit tests"] },
  { canonical: "Test Automation", aliases: ["automated testing", "automation testing"] },
  { canonical: "TDD", aliases: ["test driven development"] },

  // ── Ways of working ────────────────────────────────────────────────────
  { canonical: "Agile", aliases: ["agile delivery", "agile methodology", "agile methodologies"] },
  { canonical: "Scrum" },
  { canonical: "Kanban" },
  { canonical: "JIRA" },
  { canonical: "Confluence" },
  { canonical: "Git" },
  { canonical: "Code Review", aliases: ["code reviews"] },

  // ── Data & analytics ───────────────────────────────────────────────────
  { canonical: "Machine Learning" },
  { canonical: "Deep Learning" },
  { canonical: "Data Analysis", aliases: ["data analytics"] },
  { canonical: "Power BI", aliases: ["powerbi"] },
  { canonical: "Tableau" },
  { canonical: "Excel", aliases: ["microsoft excel", "ms excel"] },
  { canonical: "Pandas" },
  { canonical: "NumPy" },
  { canonical: "TensorFlow" },
  { canonical: "PyTorch" },
  { canonical: "ETL" },
  { canonical: "Airflow", aliases: ["apache airflow"] },
  { canonical: "Spark", aliases: ["apache spark", "pyspark"] },

  // ── Non-engineering skills that show up in Indian-market JDs ───────────
  { canonical: "Project Management" },
  { canonical: "Product Management" },
  { canonical: "Stakeholder Management" },
  { canonical: "Business Analysis" },
  { canonical: "Requirement Gathering", aliases: ["requirements gathering"] },
  { canonical: "Salesforce" },
  { canonical: "SAP" },
  { canonical: "Digital Marketing" },
  { canonical: "SEO", aliases: ["search engine optimisation", "search engine optimization"] },
  { canonical: "Content Marketing" },
  { canonical: "Customer Support" },
  { canonical: "Team Leadership", aliases: ["team lead", "people management"] },
  { canonical: "Mentoring", aliases: ["mentorship"] },
];

/**
 * surface form (lowercase) -> canonical display form.
 * Built once; both the canonical spelling and every alias map to the canonical.
 */
export const SKILL_SURFACE_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const { canonical, aliases } of SKILL_LEXICON) {
    m.set(canonical.toLowerCase(), canonical);
    for (const a of aliases ?? []) m.set(a.toLowerCase(), canonical);
  }
  return m;
})();

/** Longest surface forms first, so "spring boot" wins over "spring". */
export const SKILL_SURFACES_BY_LENGTH: readonly string[] = [
  ...SKILL_SURFACE_TO_CANONICAL.keys(),
].sort((a, b) => b.length - a.length);

/**
 * Surfaces that are also ordinary English words, with the contexts that mean
 * the everyday sense rather than the skill.
 *
 * "React" and "Excel" are the two that bite in real resumes: "I react quickly
 * to incidents" and "I excel at stakeholder communication" are both common
 * prose, and crediting either as a technology is a false claim about the
 * candidate. The guard is checked against the text immediately FOLLOWING the
 * match.
 */
export const AMBIGUOUS_SURFACE_GUARDS: Record<string, RegExp> = {
  react: /^\s+(to|quickly|fast|faster|well|immediately|promptly|swiftly|calmly|appropriately|accordingly)\b/i,
  excel: /^\s+(at|in)\b/i,
};
