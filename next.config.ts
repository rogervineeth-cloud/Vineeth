import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships its own worker (.mjs) and uses dynamic resolution.
  // Marking it external prevents Next from bundling/mangling its internal modules.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
