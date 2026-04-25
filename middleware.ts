import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip basic auth for API routes — they handle auth themselves
  if (!pathname.startsWith("/api/")) {
    const user = process.env.SITE_AUTH_USER;
    const pass = process.env.SITE_AUTH_PASS;

    // Only enforce if both env vars are set (allows disabling by removing them)
    if (user && pass) {
      const authHeader = request.headers.get("authorization");
      const expected = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

      if (authHeader !== expected) {
        return new NextResponse("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Neduresume"' },
        });
      }
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
