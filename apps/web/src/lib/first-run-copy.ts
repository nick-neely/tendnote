/**
 * The first run's words (#639). The question is the whole of the first-run path:
 * asked once on admission, and once more on the Home a skip lands on. The
 * assistant is "the assistant" here as everywhere (DESIGN.md §6).
 */
export const FIRST_RUN_QUESTION = "Who did you talk to this week?";
export const FIRST_RUN_WELCOME_DETAIL =
  "Tell the assistant one thing they said, the way you’d tell a friend. It will offer to save who it was and remember it.";
export const FIRST_RUN_REPEAT_DETAIL =
  "Tell the assistant one thing they said. Tendnote starts with the people in your life.";

/** The search parameter a skip lands on, so Home repeats the prompt exactly once. */
const FIRST_RUN_SKIPPED_PARAM = "firstRun";
export const FIRST_RUN_SKIPPED_VALUE = "skipped";
export const FIRST_RUN_SKIPPED_HREF = `/?${FIRST_RUN_SKIPPED_PARAM}=${FIRST_RUN_SKIPPED_VALUE}`;

/** What the first run asks of this Home render. */
export type FirstRunPrompt = "welcome" | "repeat" | null;

/** The composer's placeholder while the first run is asking, or `null` when it is not. */
export function firstRunPlaceholder(prompt: FirstRunPrompt): string | null {
  if (prompt === "welcome") return "Who it was, and one thing they said…";
  if (prompt === "repeat") return `${FIRST_RUN_QUESTION} One thing they said…`;
  return null;
}
