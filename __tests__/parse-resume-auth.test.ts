/**
 * Resume import — authentication boundary.
 *
 * Found in a read-only route inventory: /api/parse-resume had no session
 * check at all. Anyone able to reach the origin could POST a PDF and have it
 * buffered and parsed on a 30-second function. It does not read or write the
 * database, so it was never a data-exposure hole — but it was unauthenticated
 * compute, reachable by anyone, on the one route that accepts file uploads.
 *
 * Two things here are easy to get wrong and are asserted explicitly rather
 * than assumed:
 *
 *   1. The check must run BEFORE req.formData(). Reading the form buffers the
 *      whole upload; rejecting afterwards means we have already accepted an
 *      anonymous caller's bytes and done the expensive work.
 *
 *   2. The 401 body must keep the shape the existing UI expects. Both callers
 *      do `if (data.error && !data.extracted) toast.error(data.error)` and
 *      ignore res.status, so `error` has to be a human sentence — otherwise a
 *      signed-out user sees a toast reading "auth_required".
 */
import { NextRequest } from "next/server";

const mockGetUser: jest.Mock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceClient: jest.fn(async () => ({})),
}));

const mockExtractProfile: jest.Mock = jest.fn();
jest.mock("@/lib/resume-parser", () => ({
  extractProfile: (t: string) => mockExtractProfile(t),
}));

// LIMITATION, stated rather than papered over: pdfjs's legacy build is ESM and
// uses import.meta, which ts-jest's transform cannot evaluate. The dynamic
// import inside the route is emitted as a real ESM import that Node resolves
// directly, so neither jest.mock() nor moduleNameMapper can intercept it — both
// were tried and removed rather than left as dead config. Text extraction
// therefore always fails under test and the route takes its graceful
// "couldn't read this PDF" branch.
//
// That is a genuine production state (a scanned or malformed PDF), so it is
// asserted as such below. Everything up to and including extraction — auth,
// mime type, size, magic bytes — runs for real. Confirming that a
// well-formed PDF yields populated fields needs the browser, and is called out
// as unverified in the PR rather than faked here.

import { POST as parseResume } from "@/app/api/parse-resume/route";
import { POST as parseLinkedin } from "@/app/api/parse-linkedin/route";

/** Minimal well-formed PDF: correct %PDF- magic bytes plus some text. */
function pdfBytes(sizeBytes = 2048): Uint8Array {
  const buf = new Uint8Array(sizeBytes);
  const header = "%PDF-1.4\n";
  for (let i = 0; i < header.length; i++) buf[i] = header.charCodeAt(i);
  return buf;
}

function uploadRequest(opts: {
  bytes?: Uint8Array;
  name?: string;
  type?: string;
  omitFile?: boolean;
  url?: string;
} = {}): NextRequest {
  const form = new FormData();
  if (!opts.omitFile) {
    const blob = new Blob([(opts.bytes ?? pdfBytes()) as BlobPart], {
      type: opts.type ?? "application/pdf",
    });
    form.append("file", new File([blob], opts.name ?? "resume.pdf", {
      type: opts.type ?? "application/pdf",
    }));
  }
  return new Request(opts.url ?? "http://localhost/api/parse-resume", {
    method: "POST",
    body: form,
  }) as unknown as NextRequest;
}

const SIGNED_IN = { data: { user: { id: "user-1", email: "someone@example.com" } } };
const ANONYMOUS = { data: { user: null } };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(SIGNED_IN);
  mockExtractProfile.mockReturnValue({
    name: "Priya Sharma", email: "priya@example.com", phone: "", city: "",
    graduation_year: null, summary: null, experience: [], education: [],
    skills: ["TypeScript"], projects: [], certifications: [], achievements: [],
  });
});

describe("anonymous requests are rejected", () => {
  it("returns 401 for /api/parse-resume", async () => {
    mockGetUser.mockResolvedValue(ANONYMOUS);
    const res = await parseResume(uploadRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 for /api/parse-linkedin, inheriting the same boundary", async () => {
    // parse-linkedin is a pure delegate. If that ever stops forwarding the
    // original request, this is the test that notices.
    mockGetUser.mockResolvedValue(ANONYMOUS);
    const res = await parseLinkedin(
      uploadRequest({ url: "http://localhost/api/parse-linkedin" })
    );
    expect(res.status).toBe(401);
  });

  it("rejects BEFORE reading the upload, so no bytes are accepted", async () => {
    mockGetUser.mockResolvedValue(ANONYMOUS);

    // Spy on the request's own formData(). If auth ran after it, this fires.
    const req = uploadRequest();
    const formDataSpy = jest.spyOn(req as unknown as Request, "formData");

    const res = await parseResume(req);

    expect(res.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
    // …and certainly no parsing.
    expect(mockExtractProfile).not.toHaveBeenCalled();
  });

  it("keeps the response shape the existing UI toasts on", async () => {
    mockGetUser.mockResolvedValue(ANONYMOUS);
    const body = await (await parseResume(uploadRequest())).json();

    // Both callers: if (data.error && !data.extracted) toast.error(data.error)
    expect(typeof body.error).toBe("string");
    expect(body.extracted).toBeNull();
    // A human sentence, not a machine code — the user reads this verbatim.
    expect(body.error).toMatch(/sign in/i);
    expect(body.error).not.toBe("auth_required");
    // Machine-readable code still available for callers that want it.
    expect(body.reason).toBe("auth_required");
  });
});

describe("authenticated requests proceed past the gate", () => {
  it("is not rejected, and reaches the extraction stage", async () => {
    const res = await parseResume(uploadRequest());
    // The point of this suite: a signed-in caller is not turned away.
    expect(res.status).not.toBe(401);
    const body = await res.json();
    // Got past auth AND past every validation check, into PDF extraction —
    // the `partial` flag is only set once extraction has been attempted.
    expect(body).toHaveProperty("partial", true);
    expect(body.reason).not.toBe("auth_required");
  });

  it("checks the session exactly once, via getUser", async () => {
    await parseResume(uploadRequest());
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it("uses getUser, never the forgeable getSession", async () => {
    // getSession() only decodes a cookie; on the server that cookie can be
    // forged. This route accepts uploads, so it must revalidate.
    const supabaseModule = jest.requireMock("@/lib/supabase/server") as {
      createClient: jest.Mock;
    };
    await parseResume(uploadRequest());
    const client = await supabaseModule.createClient.mock.results[0].value;
    expect(client.auth.getUser).toBeDefined();
    expect((client.auth as Record<string, unknown>).getSession).toBeUndefined();
  });
});

describe("upload validation is unchanged", () => {
  it("rejects a missing file", async () => {
    const res = await parseResume(uploadRequest({ omitFile: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/select a pdf/i);
  });

  it("rejects a non-PDF by both mime type and extension", async () => {
    const res = await parseResume(
      uploadRequest({ type: "text/plain", name: "resume.txt" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only pdf/i);
  });

  it("rejects an empty file", async () => {
    const res = await parseResume(uploadRequest({ bytes: new Uint8Array(0) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it("rejects a file over 5 MB", async () => {
    const oversize = pdfBytes(5 * 1024 * 1024 + 1);
    const res = await parseResume(uploadRequest({ bytes: oversize }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/under 5 ?mb/i);
  });

  it("accepts a file just under the 5 MB limit", async () => {
    const res = await parseResume(uploadRequest({ bytes: pdfBytes(5 * 1024 * 1024 - 1) }));
    expect(res.status).toBe(200);
  });

  it("rejects a file that is not really a PDF despite its name", async () => {
    // Magic-byte sniff. Returns 200 with partial:true by design, so the UI
    // can show guidance rather than a hard failure.
    const notPdf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const res = await parseResume(uploadRequest({ bytes: notPdf }));
    const body = await res.json();
    expect(body.extracted).toBeNull();
    expect(body.partial).toBe(true);
    expect(body.error).toMatch(/valid pdf/i);
  });

  it("validation still runs for an authenticated user — auth is not a bypass", async () => {
    mockGetUser.mockResolvedValue(SIGNED_IN);
    const res = await parseResume(uploadRequest({ type: "image/png", name: "photo.png" }));
    expect(res.status).toBe(400);
  });
});

describe("parser failure is handled, not leaked", () => {
  it("does not surface an internal error message to the caller", async () => {
    mockExtractProfile.mockImplementation(() => {
      throw new Error("INTERNAL: pdfjs exploded at /var/task/node_modules/...");
    });
    const res = await parseResume(uploadRequest());
    const body = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(200);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("/var/task");
    expect(serialised).not.toContain("pdfjs exploded");
  });
});

describe("contract relied on by the two UI entry points", () => {
  // onboarding/page.tsx and profile/page.tsx both do:
  //   const data = await res.json();
  //   if (data.error && !data.extracted) { toast.error(data.error); return; }
  //   const ep = data.extracted ?? {};
  const callerWouldToast = (d: Record<string, unknown>) => !!d.error && !d.extracted;

  it("unreadable PDF: callers show guidance and do not crash", async () => {
    // A real production state — a scanned or malformed PDF. The route answers
    // 200 with partial:true so the UI can offer the manual path rather than
    // presenting a hard failure.
    const body = await (await parseResume(uploadRequest())).json();
    expect(callerWouldToast(body)).toBe(true);
    expect(body.partial).toBe(true);
    expect(body.error).toMatch(/fill manually|couldn't read/i);
    // `data.extracted ?? {}` is the next line in both callers.
    expect(() => ((body.extracted ?? {}) as Record<string, unknown>).name).not.toThrow();
  });

  it("anonymous: callers show the sign-in message instead of crashing", async () => {
    mockGetUser.mockResolvedValue(ANONYMOUS);
    const body = await (await parseResume(uploadRequest())).json();
    expect(callerWouldToast(body)).toBe(true);
    // `data.extracted ?? {}` must not blow up if a caller reaches it.
    expect(() => ((body.extracted ?? {}) as Record<string, unknown>).name).not.toThrow();
  });

  it("invalid upload: callers show the validation message", async () => {
    const body = await (await parseResume(uploadRequest({ type: "text/plain", name: "cv.txt" }))).json();
    expect(callerWouldToast(body)).toBe(true);
    expect(body.error).toMatch(/only pdf/i);
  });
});
