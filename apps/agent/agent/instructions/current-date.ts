import { defineDynamic, defineInstructions } from "eve/instructions";

/**
 * Today's date as a friendly + ISO string, anchored in UTC for determinism.
 *
 * The model has no inherent knowledge of the current date and will otherwise
 * guess — often a year in the past — which makes it resolve relative asks like
 * "anything next week?" to the wrong window (see the get_relationship_agenda
 * calendar). Anchoring the prompt on the real date fixes that for every tool
 * that takes a concrete date, not just the agenda.
 */
function currentDateMarkdown(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const friendly = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return [
    "# Today's date",
    "",
    `Today is ${friendly} (${iso}).`,
    "",
    "You have no other knowledge of the current date — always anchor on this one.",
    'Resolve every relative date the user mentions ("today", "tomorrow", "this',
    'weekend", "next week", "in a month") against it, and pass concrete ISO 8601',
    "dates to any tool that needs them.",
  ].join("\n");
}

/**
 * Recomputed at the start of every turn so the date stays correct across midnight
 * and long-lived sessions. It stays stable within a day, so prompt caching for the
 * system block is preserved between turns on the same date.
 */
export default defineDynamic({
  events: {
    // A dynamic instructions resolver returns the branded defineInstructions()
    // value directly — not wrapped in a `{ export }` map (that's the tool shape).
    // An unbranded return is silently dropped, so the date never reaches the prompt.
    "turn.started": () => defineInstructions({ markdown: currentDateMarkdown() }),
  },
});
