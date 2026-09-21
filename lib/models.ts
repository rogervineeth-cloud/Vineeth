// Claude model IDs, in one place.
//
// These were previously inlined at each call site, and one of them
// (`claude-sonnet-4-5-20251101`) did not exist. Anthropic returned
// 404 not_found_error, the route turned that into a generic "Something went
// wrong", and resume generation failed 100% of the time for the creator
// account with nothing surfacing the real cause.
//
// Keep every model reference here so a bad ID is a one-line fix and shows up
// in one grep.
//
// Valid IDs as of this change:
//   claude-opus-5
//   claude-sonnet-5
//   claude-haiku-4-5-20251001

/** Resume generation for the creator account. */
export const MODEL_RESUME_CREATOR = "claude-sonnet-5";

/**
 * Resume generation for everyone else.
 *
 * NOTE: paying customers currently get Haiku while the creator gets Sonnet.
 * That tiering predates this fix and is a cost decision, so it is left as-is
 * here — but Sonnet follows the ANTI-FABRICATION section of the system prompt
 * considerably more reliably, and invented metrics are the product's biggest
 * quality risk. Worth revisiting.
 */
export const MODEL_RESUME_STANDARD = "claude-haiku-4-5-20251001";

/** LinkedIn profile rewrite. */
export const MODEL_LINKEDIN_REWRITE = "claude-sonnet-5";
