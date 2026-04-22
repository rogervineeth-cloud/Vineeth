import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// Register fonts (system fonts work without network)
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  contact: {
    fontSize: 9,
    color: "#6b6b6b",
    marginBottom: 14,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginBottom: 12,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#1f5c3a",
    marginBottom: 6,
  },
  bodyText: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: "#1a1a1a",
  },
  expRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  expCompany: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  expMeta: {
    fontSize: 8.5,
    color: "#6b6b6b",
  },
  bullet: {
    flexDirection: "row",
    marginBottom: 2,
    paddingLeft: 8,
  },
  bulletDot: {
    width: 10,
    fontSize: 9.5,
    color: "#1f5c3a",
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
    lineHeight: 1.4,
  },
  skillsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  skillPill: {
    fontSize: 8.5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    color: "#1a1a1a",
  },
  eduRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  projName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
});

type ResumeJson = {
  summary: string;
  experience: Array<{ company: string; role: string; duration: string; location: string; bullets: string[] }>;
  skills: string[];
  education: Array<{ institution: string; degree: string; year: string; location: string; cgpa?: string }>;
  projects: Array<{ name: string; description: string; tech: string[] }>;
  tailored_role: string;
  ats_score: number;
};

function ResumePDF({ rj, name, contact }: { rj: ResumeJson; name: string; contact: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.contact}>{contact}</Text>
        <View style={styles.divider} />

        {/* Summary */}
        {rj.summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.bodyText}>{rj.summary}</Text>
          </View>
        ) : null}

        {/* Experience */}
        {rj.experience?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Experience</Text>
            {rj.experience.map((exp, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <View style={styles.expRow}>
                  <Text style={styles.expCompany}>{exp.company} — {exp.role}</Text>
                  <Text style={styles.expMeta}>{exp.duration} · {exp.location}</Text>
                </View>
                {exp.bullets?.map((b, j) => (
                  <View key={j} style={styles.bullet}>
                    <Text style={styles.bulletDot}>·</Text>
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {/* Skills */}
        {rj.skills?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.skillsWrap}>
              {rj.skills.map((skill, i) => (
                <Text key={i} style={styles.skillPill}>{skill}</Text>
              ))}
            </View>
          </View>
        ) : null}

        {/* Education */}
        {rj.education?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Education</Text>
            {rj.education.map((edu, i) => (
              <View key={i} style={styles.eduRow}>
                <View>
                  <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{edu.institution}</Text>
                  <Text style={{ fontSize: 9, color: "#6b6b6b" }}>{edu.degree}{edu.cgpa ? ` · ${edu.cgpa}` : ""}</Text>
                </View>
                <Text style={styles.expMeta}>{edu.year} · {edu.location}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Projects */}
        {rj.projects?.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Projects</Text>
            {rj.projects.map((proj, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={styles.projName}>{proj.name}</Text>
                <Text style={{ fontSize: 9.5, color: "#6b6b6b", lineHeight: 1.4 }}>{proj.description}</Text>
                {proj.tech?.length > 0 && (
                  <Text style={{ fontSize: 8.5, color: "#1f5c3a", marginTop: 2 }}>
                    {proj.tech.join(" · ")}
                  </Text>
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
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch resume + profile from Supabase using anon client (session cookie)
    // Note: This uses the session cookie for auth, not a server-side DB call
    const [resumeRes, profileRes] = await Promise.all([
      supabase.from("resumes").select("*").eq("id", id).eq("user_id", session.user.id).single(),
      supabase.from("profiles").select("full_name,email,phone,current_city").eq("user_id", session.user.id).single(),
    ]);

    if (resumeRes.error || !resumeRes.data) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const resume = resumeRes.data;
    const profile = profileRes.data;
    const rj = resume.resume_json as ResumeJson;

    const name = profile?.full_name ?? "Candidate";
    const contact = [profile?.email, profile?.phone, profile?.current_city].filter(Boolean).join(" · ");

    const pdfBuffer = await renderToBuffer(
      <ResumePDF rj={rj} name={name} contact={contact} />
    );

    // Mark as downloaded
    await supabase.from("resumes").update({ downloaded_at: new Date().toISOString() }).eq("id", id);

    const role = (rj.tailored_role ?? "resume").toLowerCase().replace(/\s+/g, "-");

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume-${role}.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF download error:", err);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
