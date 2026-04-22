"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    const supabase = createClient();
    const { data: authData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    // If session exists immediately, email confirmation is disabled — go straight in
    if (authData.session) {
      toast.success("Account created!");
      router.push("/onboarding");
      return;
    }
    // Email confirmation required — show "check your inbox" state
    setEmailSent(true);
    setLoading(false);
  }

  async function handleGoogle() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    if (error) toast.error(error.message);
  }

  if (emailSent) {
    return (
      <div className="min-h-screen bg-[#f7f3ea] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <Link href="/" className="block font-serif italic text-2xl text-[#1f5c3a] mb-8">
            Neduresume
          </Link>
          <div className="bg-white rounded-xl border border-stone-200 p-8 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-[#1f5c3a]/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✉️</span>
            </div>
            <h2 className="text-lg font-semibold text-[#1a1a1a] mb-2">Check your inbox</h2>
            <p className="text-sm text-[#6b6b6b] mb-6">
              We sent a confirmation link to your email. Click it to activate your account and continue.
            </p>
            <p className="text-xs text-[#6b6b6b]">
              Already confirmed?{" "}
              <Link href="/login" className="text-[#1f5c3a] hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="block text-center font-serif italic text-2xl text-[#1f5c3a] mb-8">
          Neduresume
        </Link>

        <div className="bg-white rounded-xl border border-stone-200 p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-[#1a1a1a] mb-1">Create your account</h1>
          <p className="text-sm text-[#6b6b6b] mb-6">Free to start. Generate and preview your first resume.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 8 characters"
                autoComplete="new-password"
                {...register("password")}
              />
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <Button type="submit" disabled={loading} className="mt-2">
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-stone-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-[#6b6b6b]">or</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogle} type="button">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </Button>
        </div>

        <p className="text-center text-sm text-[#6b6b6b] mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-[#1f5c3a] hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
