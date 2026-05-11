// Server-only — uses cookies(), do not import in client components.
//
// Entitlement helpers for one-shot add-ons. Today this only knows about
// LinkedIn Rewrite. Add new addon ids to the union below as they're sold.
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type AddonId = "linkedin_rewrite";

export type UserAddon = {
  id: string;
  user_id: string;
  addon_id: AddonId;
  granted_at: string;
  used_at: string | null;
  is_test: boolean;
};

/** Returns true iff the user has at least one unused entitlement for this addon. */
export async function hasAddonEntitlement(userId: string, addonId: AddonId): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_addons")
    .select("id")
    .eq("user_id", userId)
    .eq("addon_id", addonId)
    .is("used_at", null)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Atomically mark one entitlement row as used. Returns false if no unused row
 * was available (caller should treat as 402).
 */
export async function consumeAddon(userId: string, addonId: AddonId): Promise<boolean> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("user_addons")
    .select("id")
    .eq("user_id", userId)
    .eq("addon_id", addonId)
    .is("used_at", null)
    .order("granted_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!row) return false;

  const svc = await createServiceClient();
  const { data } = await svc
    .from("user_addons")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null) // optimistic lock
    .select("id");
  return (data?.length ?? 0) > 0;
}

/** Insert a test entitlement via the service role (bypasses RLS). */
export async function grantTestAddon(userId: string, addonId: AddonId): Promise<UserAddon> {
  const svc = await createServiceClient();
  const { data, error } = await svc
    .from("user_addons")
    .insert({ user_id: userId, addon_id: addonId, is_test: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as UserAddon;
}
