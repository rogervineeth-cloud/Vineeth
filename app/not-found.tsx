import Link from "next/link";
import { Button } from "@/components/ui/button";

// Branded 404. Previously this fell through to the bare Next.js default page,
// which had no nav and no way back into the product.
export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#f7f3ea] flex flex-col">
      <header className="border-b border-stone-200/60">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="font-serif italic text-xl text-[#1f5c3a] font-bold">
            Neduresume
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="font-serif italic text-6xl text-[#1f5c3a] mb-4">404</p>
          <h1 className="font-serif italic text-3xl text-[#1a1a1a] mb-3">
            This page doesn&apos;t exist
          </h1>
          <p className="text-sm text-[#6b6b6b] mb-8">
            The link may be broken, or the page may have moved. Your resumes are
            safe — head back to your dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild className="bg-[#1f5c3a] hover:bg-[#174d30]">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
          <p className="text-xs text-[#6b6b6b] mt-8">
            Stuck?{" "}
            <a href="mailto:support@neduresume.com" className="text-[#1f5c3a] hover:underline">
              support@neduresume.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
