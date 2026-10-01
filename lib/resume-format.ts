// Text formatting shared by the PDF renderer and the in-app preview, so both
// show a resume the same way. No pdf-lib here: the preview is a client page.

/** "8.1" reads as a CGPA; "78%" or "CGPA 8.1" is shown as written. */
export function formatGrade(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return /^\d{1,2}(?:\.\d{1,2})?$/.test(v) && Number(v) <= 10 ? `CGPA ${v}` : v;
}

/** A project description split into its sentences, each shown as a bullet. */
export function descriptionBullets(description: string): string[] {
  return (description ?? "")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
