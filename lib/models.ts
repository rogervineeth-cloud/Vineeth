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

// Cost policy: Haiku everywhere for resume generation. It is the cheapest
// current model, and per-resume margin matters at ₹99.
//
// Quality is protected by structure rather than by spending more per call:
//   - temperature 0 (see GENERATION_TEMPERATURE) so output is deterministic
//     and the model stops improvising
//   - the ANTI-FABRICATION section of the system prompt
//   - lib/sanitise-resume.ts, which mechanically strips any company, school or
//     metric that is not grounded in the user's profile
//
// That last one is the real guarantee: it does not depend on the model
// behaving, so a cheaper model cannot introduce fabrications that survive.

/** Resume generation for the creator account. Same model as everyone else. */
export const MODEL_RESUME_CREATOR = "claude-haiku-4-5-20251001";

/** Resume generation for paying customers. */
export const MODEL_RESUME_STANDARD = "claude-haiku-4-5-20251001";

/**
 * LinkedIn profile rewrite. Kept on Sonnet: it is a ₹499 add-on producing
 * long-form prose, where quality is the product and volume is low.
 */
export const MODEL_LINKEDIN_REWRITE = "claude-sonnet-5";

/**
 * 0 for resume generation. The task is structured extraction and rewriting
 * against a fixed JSON contract, not creative writing — sampling variance here
 * shows up as invented detail and inconsistent formatting, which is exactly
 * what we do not want.
 */
export const GENERATION_TEMPERATURE = 0;
