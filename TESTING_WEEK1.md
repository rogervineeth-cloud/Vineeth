# Week 1 Manual Test Plan

Run through these tests on the Vercel preview deployment after the latest build passes.

---

## Test 1: Site auth protection

- Visit site while not logged in to basic auth → should see browser auth prompt
- Enter credentials → proceeds normally

---

## Test 2: PDF generation (the bug from last time)

- Login as existing test user with a generated resume
- Click Download PDF → loading spinner shows
- PDF downloads, opens cleanly, no watermark
- Re-download same PDF → works without consuming credit
- Check Vercel logs → no 500 errors

---

## Test 3: Payment gating (free user)

- Sign up as brand new user → complete profile → target roles → basics
- Visit /create → see "You'll need a paid plan" banner
- Paste JD and click Generate → blocked with toast, redirected to /pricing
- On /pricing, click "Choose Fresher" → currently shows "coming soon" toast

---

## Test 4: Payment gating (test plan user)

- Use the dev grant-test-plan endpoint (since TEST_MODE is on)
- Grant yourself a Fresher plan via the Dev button on /pricing
- /dashboard now shows "Fresher plan · 5 of 5 resumes remaining"
- Generate a resume → works → credit consumed → dashboard shows "4 of 5 remaining"
- Visit /preview/[id] → Download PDF button works (no paywall)

---

## Test 5: Pre-generation editing (the logic fix)

- Go to /profile → edit a bullet → see "Saved" indicator
- No AI calls happening (check Network tab: only Supabase calls, no /api/generate-resume)
- Navigate away and back → edits persisted
- Visit /preview/[id] → verify there is NO Edit button anywhere
- Confirm "Update my profile and regenerate" link goes to /profile

---

## Test 6: Free regeneration window

- Generate resume with JD_A (uses 1 credit → 3 of 5 remaining)
- Within 24 hours, click "Regenerate with same JD" → should be free (still 3 of 5)
- Generate with different JD_B → uses another credit (2 of 5 remaining)

---

## Test 7: Credit exhaustion

- Generate 5 resumes total (exhaust Fresher plan)
- Try 6th generation → blocked with toast, redirect to /pricing
- Dashboard shows "0 of 5 remaining"
- Buy Job Hunter via dev button → now have 12 fresh credits

---

## Test 8: Generation failure handling

- (Harder to test on purpose) — but verify that if Anthropic returns an error, credit is NOT consumed. You can simulate this by temporarily pointing ANTHROPIC_API_KEY to an invalid key in Vercel, trying a generation, seeing the error handled cleanly, then restoring the key.

---

## Test 9: Issue reporting

- On /profile, click "Report a generation issue"
- Select a previous resume, describe issue, submit
- Verify a row was created in generation_issues table in Supabase
- Thank-you message shows

---

## Test 10: AI quality check

- Generate a resume using your real LinkedIn PDF + a real Naukri JD for Distribution Manager
- Read the output carefully:
  - Are bullets specific and quantified?
  - Does ATS score feel realistic?
  - Are matched_keywords actually in the resume?
  - Are missing_keywords helpful suggestions?
  - Would you send this resume to a recruiter?

If Test 10 fails on quality, the system prompt needs more iteration — come back and we'll tune it.
