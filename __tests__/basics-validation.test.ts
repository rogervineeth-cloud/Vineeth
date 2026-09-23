// Basics validation. Before this, "notanemail" passed the profile checklist,
// "abc" passed as a phone number, and "abcd-9999" passed as a graduation year
// — so resumes shipped with unreachable contact details.
import { isValidEmail, isValidPhone, isValidGradYear } from "@/lib/profile-basics";

describe("isValidEmail", () => {
  it.each(["a@b.co", "aarav.menon@example.com", "x+tag@sub.domain.in"])(
    "accepts %s",
    (v) => expect(isValidEmail(v)).toBe(true)
  );

  it.each(["notanemail", "", "   ", "a@b", "a b@c.com", "@b.com", "a@.com"])(
    "rejects %s",
    (v) => expect(isValidEmail(v)).toBe(false)
  );

  it("ignores surrounding whitespace", () => {
    expect(isValidEmail("  a@b.co  ")).toBe(true);
  });
});

describe("isValidPhone", () => {
  it("treats blank as valid (the field is optional)", () => {
    expect(isValidPhone("")).toBe(true);
    expect(isValidPhone("   ")).toBe(true);
  });

  it.each(["+91 98765 43210", "9876543210", "+1 (555) 123-4567"])(
    "accepts %s",
    (v) => expect(isValidPhone(v)).toBe(true)
  );

  it.each(["abc", "12345", "not a phone", "+91-abcd-efgh"])(
    "rejects %s",
    (v) => expect(isValidPhone(v)).toBe(false)
  );
});

describe("isValidGradYear", () => {
  it("treats blank as valid (the field is optional)", () => {
    expect(isValidGradYear("")).toBe(true);
  });

  it.each(["2022", "1999", "2026"])("accepts %s", (v) =>
    expect(isValidGradYear(v)).toBe(true)
  );

  it.each(["abcd-9999", "99", "20222", "1800", "9999", "20.22"])(
    "rejects %s",
    (v) => expect(isValidGradYear(v)).toBe(false)
  );
});
