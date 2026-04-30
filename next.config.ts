import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships its own worker (.mjs) and uses dynamic resolution.
  // Marking it external prevents Next from bundling/mangling its internal modules.
  serverExternalPackages: ["pdfjs-dist"],
  // Vercel's NFT (file tracing) misses some files that pdfjs-dist needs at
  // runtime in serverless functions — notably the `legacy/build/pdf.mjs` entry
  // we dynamic-import, plus its WASM/cmap assets. Force-include them so the
  // /api/parse-resume Lambda actually has them on disk.
  outputFileTracingIncludes: {
    "/api/parse-resume": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/build/pdf.mjs",
      "./node_modules/pdfjs-dist/wasm/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
    ],
  },
};

export default nextConfig;
