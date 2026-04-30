import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse v2 bundles a pdfjs worker (.mjs) and uses dynamic requires.
  // Marking it external prevents Next from inlining it and breaking the worker.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
