import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships its own worker (.mjs) and uses dynamic resolution.
  // Marking it external prevents Next from bundling/mangling its internal modules.
  serverExternalPackages: ["pdfjs-dist"],
  // Vercel's NFT (file tracing) sometimes misses the legacy build subpath
  // we dynamic-import in /api/parse-resume — the deployed Lambda then throws
  // "Cannot find module" at runtime. Force-include the entries we use.
  outputFileTracingIncludes: {
    "/api/parse-resume": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/build/pdf.mjs",
    ],
  },
};

export default nextConfig;
