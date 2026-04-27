"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";

type ProfileBasics = { full_name: string | null; email: string | null } | null;

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileBasics>(null);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load(uid: string) {
      const { data } = await supabase.from("profiles").select("full_name,email,target_roles,linkedin_data").eq("user_id", uid).single();
      setProfile(data ? { full_name: data.full_name, email: data.email } : null);
      // Compute readiness for the gate
      const ld = (data?.linkedin_data ?? {}) as Record<string, unknown>;
      const exp = Array.isArray(ld.experience) ? ld.experience : [];
      const edu = Array.isArray(ld.education) ? ld.education : [];
      const targetRoles = Array.isArray(data?.target_roles) ? data.target_roles : [];
      const ready = !!data?.full_name?.trim() && !!data?.email?.trim() && targetRoles.length > 0 && exp.length > 0 && edu.length > 0;
      setIsReady(ready);
    }
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); if (data.user) load(data.user.id); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { load(session.user.id); } else { setProfile(null); setIsReady(false); }
    });
    return () => subscription.unsubscribe();
  }, [pathname]);

  useEffect(() => {
    if (!showMissing) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowMissing(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showMissing]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function handleGenerate() {
    if (isReady) { router.push("/create"); return; }
    const missing: string[] = [];
    if (!profile?.full_name?.trim() || !profile?.email?.trim()) missing.push("Add your name and email in Profile → Basics");
    if (user) {
      const supabase = createClient();
      const { data: full } = await supabase.from("profiles").select("target_roles,linkedin_data").eq("user_id", user.id).single();
      const targetRoles = Array.isArray(full?.target_roles) ? full.target_roles : [];
      if (targetRoles.length === 0) missing.push("Pick at least one target role in Profile → Roles");
      const ld = (full?.linkedin_data ?? {}) as Record<string, unknown>;
      const exp = Array.isArray(ld.experience) ? ld.experience : [];
      const edu = Array.isArray(ld.education) ? ld.education : [];
      if (exp.length === 0) missing.push("Add at least one role in Profile → Experience");
      if (edu.length === 0) missing.push("Add at least one entry in Profile → Education");
    }
    setMissingItems(missing);
    setShowMissing(true);
  }

  return (
    <header className="border-b border-stone-200/60 bg-[#f7f3ea]/90 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href={user ? "/dashboard" : "/"} className="font-serif italic text-xl text-[#1f5c3a] font-bold">Neduresume</Link>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link href="/dashboard" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">Dashboard</Link>
              <Link href="/profile" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">Profile</Link>
              {pathname !== "/create" && (
                <div className="relative" ref={dropdownRef}>
                  <Button size="sm" onClick={handleGenerate} disabled={!isReady} className={!isReady ? "opacity-60 cursor-not-allowed" : ""} title={!isReady ? "Complete your profile to enable" : "Generate your resume"}>
                    ✨ Generate Resume
                  </Button>
                  {showMissing && (
                    <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-stone-200 rounded-xl shadow-lg p-4 z-20">
                      <p className="text-xs font-semibold text-[#1a1a1a] mb-2">Complete these to unlock generation:</p>
                      <ul className="flex flex-col gap-1.5 mb-3">
                        {missingItems.map((item) => (
                          <li key={item} className="text-xs text-[#6b6b6b] flex items-start gap-1.5"><span className="text-amber-500 shrink-0 mt-px">•</span>{item}</li>
                        ))}
                      </ul>
                      <Link href="/profile?step=basics" className="text-xs text-[#1f5c3a] font-medium hover:underline" onClick={() => setShowMissing(false)}>Go to Profile →</Link>
                    </div>
                  )}
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={signOut} className="text-sm">Sign out</Button>
            </>
          ) : (
            <Link href="/login" className="text-sm text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
