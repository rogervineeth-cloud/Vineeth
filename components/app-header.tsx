"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
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
