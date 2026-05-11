import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships its own worker (.mjs) and uses dynamic resolution.
  // Marking it external prevents Next from bundling/mangling its internal modules.
  serverExternalPackages: ["pdfjs-dist"],

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
