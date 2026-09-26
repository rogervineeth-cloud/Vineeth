// Job-description length feedback on /create.
//
// A JD needs at least 200 characters (ignoring surrounding whitespace). With
// 1–199 characters pasted, the page still said "Paste a job description above
// to continue" — telling the user to do what they had just done — and the
// counter counted raw length while readiness used trimmed length, so "200"
// could show beside a disabled Next. Every message now comes from here: the
// paste prompt only when nothing has been entered, otherwise the 200-character
// requirement and how far off the text is.

export const JD_MIN_CHARS = 200;

export type JdLengthStatus = {
  /** Trimmed length — what readiness is judged on. */
  count: number;
  state: "empty" | "short" | "ok";
  ready: boolean;
  /** Short line under the textarea. */
  counter: string;
  /** Why Next is disabled, or null when it is enabled. */
  blocker: string | null;
  /** Toast shown if generation is attempted anyway, or null. */
  toast: string | null;
};

export function jdLengthStatus(text: string): JdLengthStatus {
  const count = (text ?? "").trim().length;
  if (count === 0) {
    return {
      count,
      state: "empty",
      ready: false,
      counter: `0/${JD_MIN_CHARS} characters minimum`,
      blocker: "Paste a job description to continue",
      toast: "Paste a job description first.",
    };
  }
  if (count < JD_MIN_CHARS) {
    const more = JD_MIN_CHARS - count;
    return {
      count,
      state: "short",
      ready: false,
      counter: `${count}/${JD_MIN_CHARS} characters minimum`,
      blocker: `A job description needs at least ${JD_MIN_CHARS} characters — ${count} so far, ${more} more to go.`,
      toast: `This job description is ${count} characters; at least ${JD_MIN_CHARS} are needed. Add the full responsibilities and requirements.`,
    };
  }
  return { count, state: "ok", ready: true, counter: `${count} characters ✓`, blocker: null, toast: null };
}
