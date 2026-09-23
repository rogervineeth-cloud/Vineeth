import { NextRequest, NextResponse } from "next/server";

// LinkedIn export PDFs use the same shared parser as regular resumes.
// LinkedIn's "Save to PDF" output is structurally similar enough to a normal
// resume that the section-aware extractor in parse-resume catches it cleanly.
// Keeping a dedicated route here means we can specialise the LinkedIn pipeline
// later (e.g. detect the "Contact" header and pull the public profile URL)
// without touching the resume route.

import { POST as resumePost } from "../parse-resume/route";

// AUTH: this route is a pure pass-through, so it inherits the authentication
// boundary in parse-resume rather than duplicating it. The original request —
// cookies included — is forwarded untouched, so the session check runs exactly
// as it would on the resume route, and an anonymous caller gets the same 401
// before any upload is read. Duplicating the check here would create two
// places to keep in sync and one of them would eventually drift.
//
// That inheritance is a load-bearing assumption, not an obvious one, so it is
// asserted directly in __tests__/parse-resume-auth.test.ts rather than left to
// inspection.
//
// KEPT, NOT REMOVED: no caller in this repository references it (verified by
// grep across app/ and components/ — onboarding and profile both post to
// /api/parse-resume). But "no in-repo caller" is not proof that nothing calls
// it: it is a deployed public URL and could be bookmarked or scripted. Once
// authenticated it costs nothing to keep, and deleting a live endpoint to tidy
// up is a worse trade than leaving a five-line delegate in place. The
// specialisation rationale below is still the intended direction.
export async function POST(req: NextRequest): Promise<NextResponse> {
  return resumePost(req);
}
