# Neduresume

AI resume builder for Indian students and job seekers. Paste your LinkedIn profile. Paste a job description. Get an ATS-optimised, tailored resume in under 60 seconds.

Built by Vineeth (Distribution Sales Manager, Kerala) in one weekend using Claude Code — without writing a single line of code.

---

## Tech Stack

- **Framework**: Next.js 14 App Router, TypeScript strict mode
- **Styling**: Tailwind CSS v4, custom UI components (Radix UI primitives)
- **Fonts**: Instrument Serif (headings), Geist Sans (body)
- **Auth + DB**: Supabase (email/password + Google OAuth, Postgres, Row Level Security)
- **AI**: Anthropic SDK — `claude-haiku-4-5-20251001`
- **PDF**: `@react-pdf/renderer` (server-side, clean A4 output)
- **PDF parsing**: `pdf-parse` (LinkedIn PDF extraction)
- **Forms**: `react-hook-form` + `zod`
- **Toasts**: `sonner`

---

## Environment Variables

Create a `.env.local` file in the root (never commit this):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
```

Use the **legacy JWT-format keys** from Supabase (Settings → API → Project API Keys). The newer `sb_publishable_` format has host restrictions incompatible with server-side rendering.

---

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

---

## Database

Run `supabase/migrations/001_initial.sql` in your Supabase SQL Editor before first use. Creates `profiles` and `resumes` tables with RLS policies.

---

## Architecture notes

All Supabase reads/writes happen **client-side** (from the user's browser directly to Supabase). This bypasses any server-side network restrictions and keeps RLS enforcement clean. The only server-side operations are:

- `/api/generate-resume` — calls Anthropic API, returns JSON to client
- `/api/download-pdf/[id]` — renders PDF with react-pdf, streams to client
- `/api/parse-linkedin` — parses uploaded PDF, returns extracted text

---

## Known limitations / deferred to next weekend

- **Payments**: Razorpay not yet integrated. All downloads are free in this version.
- **Email notifications**: Not yet (no Resend integration).
- **Deployment**: Not yet on Vercel — tested via Claude Code preview URL.
- **Cover letter**: Not yet built.
- **LinkedIn profile rewrite**: Add-on shown on pricing, not yet functional.
- **Interview Q&A**: Deferred.

---

## Next weekend plan

1. Buy neduresume.in (₹700)
2. Deploy to Vercel
3. Razorpay payment integration (complete KYC first)
4. Resend email on resume generation
5. Soft launch with 20 friends
