/**
 * What the Assistant page offers when a new conversation has nothing else to
 * suggest.
 *
 * The calendar nudges come first wherever they exist — a real meeting this week
 * beats any generic prompt. These are the fallback: three openings that name the
 * three things the notebook is for (who to reach out to, what is coming up, and
 * writing something down), in the owner's own voice rather than the product's.
 * Deliberately not personalised: a starter that invents a name for an empty
 * notebook is worse than a plain one.
 */
export const ASSISTANT_CONVERSATION_STARTERS: readonly string[] = [
  "Who should I reach out to this week?",
  "What's coming up for the people I care about?",
  "Remember something about someone",
];
