// Profile Basics: validation, initial state, and the autosave write.
//
// Lives outside app/(app)/profile/page.tsx so the load → edit → save → reload
// round-trip can be tested without a browser. The page is a thin shell over
// these functions.
//
// THE BUG THIS MODULE FIXES (production QA, 2026-09-23)
//
// The only code that ever created a `profiles` row was the /onboarding
// submit. Nothing else does — there is no trigger on auth.users. A user who
// signs in with Google lands on /dashboard, and the header links straight to
// /profile, so onboarding is easy to skip entirely.
//
// For such a user the profile page's autosave ran
//     update profiles set ... where user_id = <them>
// against a row that did not exist. PostgREST reports an UPDATE matching zero
// rows as success, so the page showed "Saved ✓" while nothing was written,
// and every field came back blank on reload. With the email blank, the Basics
// step could never be completed, Next stayed disabled, and generation was
// unreachable — despite an active paid entitlement.
//
// The write is now an upsert keyed on user_id, and "saved" is only reported
// when the database hands the row back.

/** Pragmatic email check — something@something.tld, no spaces. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Optional field: blank is fine. Otherwise needs 7-15 digits, allowing +, -, spaces, brackets. */
export function isValidPhone(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (!/^\+?[\d\s\-()]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** Optional field: blank is fine. Otherwise a 4-digit year within a sane range. */
export function isValidGradYear(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (!/^\d{4}$/.test(v)) return false;
  const year = Number(v);
  return year >= 1950 && year <= new Date().getFullYear() + 10;
}

/**
 * Whether Basics is complete — gates the Next button and the checklist.
 * Name and a valid email are required; phone and graduation year are
 * optional but must be well-formed when present.
 */
export function isBasicsComplete(b: BasicInfo): boolean {
  return !!(
    b.full_name.trim() &&
    isValidEmail(b.email) &&
    isValidPhone(b.phone) &&
    isValidGradYear(b.graduation_year)
  );
}

export type BasicInfo = {
  full_name: string;
  email: string;
  phone: string;
  current_city: string;
  graduation_year: string;
};

/** The columns of a `profiles` row that Basics reads. */
export type ProfileBasicsRow = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  current_city?: string | null;
  graduation_year?: number | string | null;
};

/** The parts of a Supabase auth user that can seed Basics. */
export type AuthUserLike = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string {
  const v = meta?.[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Initial Basics state for the profile form.
 *
 * Stored values always win. A blank name or email falls back to what the auth
 * provider already told us — for Google that is the verified login email and
 * the account's display name (`full_name`, or `name`). Without this a Google
 * user with no profile row faced an empty form for details we already hold.
 *
 * `row` is null when the user has no profile row yet.
 */
export function initialBasics(row: ProfileBasicsRow | null, authUser: AuthUserLike | null): BasicInfo {
  const cleanPhone = (row?.phone ?? "").trim();
  const storedName = (row?.full_name ?? "").trim();
  const storedEmail = (row?.email ?? "").trim();
  const meta = authUser?.user_metadata ?? null;

  return {
    full_name: storedName || metaString(meta, "full_name") || metaString(meta, "name"),
    email: storedEmail || (authUser?.email ?? "").trim(),
    // "+91" on its own is a placeholder an older form left behind, not a number.
    phone: cleanPhone === "+91" ? "" : cleanPhone,
    current_city: row?.current_city ?? "",
    graduation_year: row?.graduation_year ? String(row.graduation_year) : "",
  };
}

/**
 * The row written by autosave. Includes user_id so the write can create the
 * row as well as update it. Columns not listed here (onboarded_at,
 * linkedin_data, free_review_used_at, created_at) are left untouched on an
 * existing row, because an upsert only sets the columns it is given.
 */
export function buildProfileWrite(
  userId: string,
  basics: BasicInfo,
  targetRoles: string[],
  profileData: Record<string, unknown>
) {
  const year = basics.graduation_year.trim();
  return {
    user_id: userId,
    full_name: basics.full_name.trim(),
    email: basics.email.trim(),
    phone: basics.phone.trim() || null,
    current_city: basics.current_city.trim() || null,
    graduation_year: year ? parseInt(year, 10) : null,
    target_roles: targetRoles,
    profile_data: profileData,
  };
}

export type ProfileWrite = ReturnType<typeof buildProfileWrite>;

// Structural type for the one query chain used here, so tests can pass a fake.
type UpsertResult = { data: unknown; error: { message: string } | null };
export type ProfilesWriter = {
  from(table: "profiles"): {
    upsert(
      row: ProfileWrite,
      opts: { onConflict: string }
    ): { select(cols: string): PromiseLike<UpsertResult> };
  };
};

export type SaveResult = { ok: true } | { ok: false; message: string };

/**
 * Persist the profile. Succeeds only when the database returns the written
 * row — an error-free response that touched nothing is a failure, not a save.
 */
export async function saveProfile(supabase: ProfilesWriter, row: ProfileWrite): Promise<SaveResult> {
  const { data, error } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "user_id" })
    .select("user_id");
  if (error) return { ok: false, message: error.message };
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, message: "Your changes could not be saved. Please refresh and try again." };
  }
  return { ok: true };
}
