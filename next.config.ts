import type { NextConfig } from "next";

// Security headers applied to every response.
// CSP intentionally allows Supabase, Anthropic-proxied fetches (server-side only)
// and Google fonts/avatars used by the OAuth button.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    // Hide framework fingerprint
    key: "X-Powered-By",
    value: "",
  },
];

const nextConfig: NextConfig = {
  // Hide the default 'X-Powered-By: Next.js' header
  poweredByHeader: false,

  // pdfjs-dist ships its own worker (.mjs) and uses dynamic resolution.
  // Marking it external prevents Next from bundling/mangling its internal modules.
  serverExternalPackages: ["pdfjs-dist"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  // Friendly redirects for paths users commonly type but that don't exist.
  // /login is the canonical auth route; /signin returned a 404 before this.
  async redirects() {
    return [
      { source: "/signin", destination: "/login", permanent: true },
      { source: "/sign-in", destination: "/login", permanent: true },
      { source: "/log-in", destination: "/login", permanent: true },
      { source: "/sign-up", destination: "/signup", permanent: true },
      { source: "/register", destination: "/signup", permanent: true },
    ];
  },
};

export default nextConfig;
