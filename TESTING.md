# Neduresume — Manual Test Checklist

Run through these 10 steps after every major change.

---

**1. Landing page loads**
- Open `/`
- Verify: cream background, italic serif headline, forest green CTA button
- Verify: pricing cards visible, "Most popular" badge on Fresher plan
- Verify: FAQ items open/close on click
- Verify: "See how it works" link smooth-scrolls to that section
- Verify: looks clean on mobile (375px viewport)

**2. Sign up with email**
- Go to `/signup`
- Enter a real email + password (8+ chars)
- Expect: redirected to `/onboarding`

**3. Google Sign in**
- Go to `/signup` → click "Continue with Google"
- Expect: Google OAuth popup → redirected to `/onboarding` (or `/dashboard` if already onboarded)

**4. Onboarding — Step 1: LinkedIn PDF**
- Go to `/onboarding`
- Upload a real LinkedIn PDF (your profile → More → Save to PDF)
- Expect: name / email auto-filled in Step 3

**5. Onboarding — Step 2: Role selection**
- Pick 2–3 roles from the chip list
- Verify: selected roles highlight in green, deselect on second click
- Verify: can't select more than 3

**6. Onboarding — Step 3: Basics**
- Check pre-filled fields from LinkedIn PDF
- Edit if needed → click "Complete setup"
- Expect: redirected to `/create`

**7. Resume generation**
- Go to `/create`
- Paste a real job description (min 200 chars) from Naukri / LinkedIn Jobs
- Click "Generate my resume"
- Expect: progress bar animates through 5 steps over ~25 seconds
- Expect: redirected to `/preview/[id]`

**8. Preview page**
- Verify: watermark "NEDURESUME PREVIEW" appears diagonally
- Verify: ATS score shown in circular ring (right panel)
- Verify: matched keywords shown in green badges
- Verify: "Consider adding" keywords shown in amber badges
- Verify: experience bullets look tailored to the JD you pasted

**9. PDF download**
- Click "Download PDF" on preview page
- Expect: PDF downloads with no watermark
- Verify: clean A4 layout — name at top, sections in order
- Verify: filename includes the role name

**10. Dashboard**
- Go to `/dashboard`
- Verify: all generated resumes appear with role, ATS score badge, date
- Generate 2 more resumes, verify they appear
- Click a card → opens preview
- Hover card → "View" and "Download" buttons appear
- Click floating "+" → goes to `/create`

---

**Edge cases to check:**
- Visiting `/dashboard` while logged out → redirected to `/login`
- Visiting `/create` while logged out → redirected to `/login`
- Submitting JD with fewer than 200 characters → error toast appears
- Sign out → header shows "Sign in", protected routes redirect
