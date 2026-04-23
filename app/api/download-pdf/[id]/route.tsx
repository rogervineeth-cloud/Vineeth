import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canDownloadResume } from "@/lib/plans";
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.registerHyphenationCallback((word) => [word]);

// All fonts are PDF-native — no network fetch needed in serverless
const S = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 44,
    paddingHorizontal: 52,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  name: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  contact: { fontSize: 9, color: "#6b6b6b", marginBottom: 4 },
  divider: { borderBottomWidth: 0.75, borderBottomColor: "#d1d5db", marginBottom: 12, marginTop: 8 },
  section: { marginBottom: 11 },
  sectionTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#1f5c3a",
    marginBottom: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d1fae5",
    paddingBottom: 2,
  },
  body: { fontSize: 9.5, lineHeight: 1.5, color: "#1a1a1a" },
  expHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  expTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  expMeta: { fontSize: 8.5, color: "#6b6b6b" },
  bullet: { flexDirection: "row", marginBottom: 1.5, paddingLeft: 6 },
  dot: { width: 10, fontSize: 9.5, color: "#1f5c3a", marginTop: 0.5 },
  bulletText: { flex: 1, fontSize: 9, lineHeight: 1.45, color: "#333333" },
  skillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  pill: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    color: "#1a1a1a",
  },
  eduRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  projName: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  projDesc: { fontSize: 9, color: "#555555", lineHeight: 1.4 },
  projTech: { fontSize: 8, color: "#1f5c3a", marginTop: 2 },
});

type ResumeJson = {
  summary?: string;
  experience?: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills?: string[];
  education?: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  projects?: Array<{ name: string; description: string; tech: string[] }>;
  tailored_role?: string;
  ats_score?: number;
};

function ResumePDF({ rj, name, contact }: { rj: ResumeJson; name: string; contact: string }) {
  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* Header */}
        <Text style={S.name}>{name}</Text>
        <Text style={S.contact}>{contact}</Text>
        <View style={S.divider} />

        {/* Summary */}
        {rj.summary ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Summary</Text>
            <Text style={S.body}>{rj.summary}</Text>
          </View>
        ) : null}

        {/* Experience */}
        {(rj.experience?.length ?? 0) > 0 ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Experience</Text>
            {rj.experience!.map((exp, i) => (
              <View key={i} style={{ marginBottom: 7 }}>
                <View style={S.expHeader}>
                  <Text style={S.expTitle}>{exp.company} — {exp.role}</Text>
                  <Text style={S.expMeta}>{exp.duration} · {exp.location}</Text>
                </View>
                {exp.bullets?.map((b, j) => (
                  <View key={j} style={S.bullet}>
                    <Text style={S.dot}>·</Text>
                    <Text style={S.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {/* Skills */}
        {(rj.skills?.length ?? 0) > 0 ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Skills</Text>
            <View style={S.skillsRow}>
              {rj.skills!.map((s, i) => (
                <Text key={i} style={S.pill}>{s}</Text>
              ))}
            </View>
          </View>
        ) : null}

        {/* Education */}
        {(rj.education?.length ?? 0) > 0 ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Education</Text>
            {rj.education!.map((edu, i) => (
              <View key={i} style={S.eduRow}>
                <View>
                  <Text style={{ fontSize: 9.5, fontFamily: "Helvetica-Bold" }}>{edu.institution}</Text>
                  <Text style={{ fontSize: 8.5, color: "#6b6b6b" }}>
                    {edu.degree}{edu.cgpa ? ` · ${edu.cgpa}` : ""}
                  </Text>
                </View>
                <Text style={S.expMeta}>{edu.year} · {edu.location}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Projects */}
        {(rj.projects?.length ?? 0) > 0 ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Projects</Text>
            {rj.projects!.map((proj, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={S.projName}>{proj.name}</Text>
                <Text style={S.projDesc}>{proj.description}</Text>
                {(proj.tech?.length ?? 0) > 0 && (
                  <Text style={S.projTech}>{proj.tech.join(" · ")}</Text>
                )}
              </View>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const debugId = crypto.randomUUID();

  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Payment gate
    const allowed = await canDownloadResume(session.user.id, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "PAYMENT_REQUIRED", message: "A paid plan is required to download.", upgrade_url: "/pricing" },
        { status: 402 }
      );
    }

    const [resumeRes, profileRes] = await Promise.all([
      supabase.from("resumes").select("*").eq("id", id).eq("user_id", session.user.id).single(),
      supabase.from("profiles").select("full_name,email,phone,current_city").eq("user_id", session.user.id).single(),
    ]);

    if (resumeRes.error || !resumeRes.data) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const rj = resumeRes.data.resume_json as ResumeJson;
    const profile = profileRes.data;
    const name = profile?.full_name ?? "Candidate";
    const contact = [profile?.email, profile?.phone, profile?.current_city].filter(Boolean).join(" · ");

    const pdfBuffer = await renderToBuffer(
      <ResumePDF rj={rj} name={name} contact={contact} />
    );

    // Mark as downloaded (best-effort, don't block the response)
    supabase
      .from("resumes")
      .update({ downloaded_at: new Date().toISOString() })
      .eq("id", id)
      .then(() => {});

    const role = (rj.tailored_role ?? "resume").toLowerCase().replace(/\s+/g, "-");

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume-${role}.pdf"`,
      },
    });
  } catch (err) {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error(`[PDF:${debugId}]`, stack);
    return NextResponse.json(
      {
        error: "PDF_GENERATION_FAILED",
        message: "Couldn't generate your PDF right now.",
        debug_id: debugId,
      },
      { status: 500 }
    );
  }
}
