import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse uses pdfjs-dist which loads a separate worker file at runtime.
  // Marking it external prevents Next/Turbopack from bundling it and breaking
  // the worker resolution path in the serverless build.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
