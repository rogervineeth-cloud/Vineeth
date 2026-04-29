import { NextRequest, NextResponse } from "next/server";

// LinkedIn export PDFs use the same shared parser as regular resumes.
// LinkedIn's "Save to PDF" output is structurally similar enough to a normal
// resume that the section-aware extractor in parse-resume catches it cleanly.
// Keeping a dedicated route here means we can specialise the LinkedIn pipeline
// later (e.g. detect the "Contact" header and pull the public profile URL)
// without touching the resume route.

import { POST as resumePost } from "../parse-resume/route";

export async function POST(req: NextRequest): Promise<NextResponse> {
  return resumePost(req);
}
