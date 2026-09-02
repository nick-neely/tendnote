import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * The follow-up chips under an Assistant turn, written by the model that answered.
 *
 * The Assistant has always shown a row of tappable follow-ups beneath the last
 * turn, and until now the web app derived them from the *kinds* of result the turn
 * produced: a person came back, so offer "Draft a check-in to Priya". A template
 * over a result kind cannot see the conversation, so it suggested things the user
 * had just been given, and - because the starter prompts are themselves derived
 * from nothing - it could hand back the very sentence the user had just sent.
 *
 * The model that wrote the answer is the only party that knows what the next
 * message would sensibly be. eve 0.47 has no custom data parts, so there is no
 * stream channel for "here is some UI state" that is not a tool result; a tool the
 * model calls at the end of its answer is the sanctioned way an app-owned typed
 * component gets fed (ADR 0027). The web client reads `output.suggestions` off the
 * `dynamic-tool` part and renders the strings as chips - the app owns the chip,
 * the model owns the words.
 *
 * ## It is presentation, and it is the only tool here that is
 *
 * Nothing is read, nothing is written, nothing is owner-scoped: there is no record
 * to scope to. That is also why it is not gated - `execute` echoes back a filtered
 * copy of its own input, so there is nothing for an owner to approve. It is
 * registered for `web_chat` and no other mode, which follows from the mode table
 * rather than needing an entry of its own: a scheduled workflow and a Discord
 * capture have no chip strip to fill, and the two narrowed modes are allowlists.
 *
 * ## Why the shape is enforced here and not only in the description
 *
 * A chip is a fixed-width control in a row of three. A model that returns six
 * suggestions, or one that returns a sentence, does not produce a worse chip - it
 * produces a broken strip, and the failure lands on the user rather than on the
 * turn. So the tool accepts what it can use and drops the rest rather than
 * throwing: a cosmetic call at the end of a good answer must never cost a retry
 * round trip, and a tool error at that point would put a red result under a reply
 * that was otherwise finished. The description still states every rule, because
 * the drop is a floor and not the intended path.
 */

/** Chips in the strip. Three is the row; a fourth is truncated, never wrapped. */
const MAX_SUGGESTIONS = 3;

/** A chip is a control, not a sentence: longer than this does not fit one. */
const MAX_SUGGESTION_LENGTH = 60;

/** Under two words is not a next step ("Priya"); over ten is prose. */
const MIN_SUGGESTION_WORDS = 2;
const MAX_SUGGESTION_WORDS = 10;

/**
 * Trailing punctuation a chip never carries, stripped rather than rejected: a
 * suggestion that is right in every way but ends in a period is worth keeping.
 * `?` is deliberately absent - "What else is due this week?" is a perfectly good
 * message to send next, and removing its mark would leave ungrammatical text on
 * the button.
 */
const TRAILING_PUNCTUATION = /[.,;:!]+$/;

/**
 * One suggestion, normalized, or null when it cannot be a chip.
 *
 * Whitespace is collapsed first so a model that wrapped a suggestion across lines
 * is not counted as having written one long word, and so the word count is a count
 * of words rather than of gaps.
 */
function acceptSuggestion(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim().replace(TRAILING_PUNCTUATION, "").trim();
  if (text.length === 0 || text.length > MAX_SUGGESTION_LENGTH) return null;

  const words = text.split(" ").length;
  if (words < MIN_SUGGESTION_WORDS || words > MAX_SUGGESTION_WORDS) return null;

  return text;
}

const inputSchema = z.object({
  suggestions: z
    .array(z.string())
    .min(1)
    .describe(
      "One to three next steps, best first. Each one is a short message the user could send you as their next turn: imperative, sentence case, 2-10 words, at most 60 characters, no trailing punctuation. Name the person, reminder, draft, or record it is about, exactly as this turn found it. Anything past the third is dropped, as is anything that does not fit that shape.",
    ),
});

export default defineTool({
  description: [
    "Offer the user one to three follow-up chips under your answer: the next things they might actually send you.",
    "Call this once, as the last tool call of a substantive answer, once you already have the facts the reply rests on.",
    'Every suggestion must be grounded in what this turn actually found - a person you resolved, a reminder that came back due, a draft you wrote, a record you read - and must name it: "Draft a birthday text to Casey", "Reopen the snoozed follow-up for Priya".',
    "Never hand the user back their own last message or one of the app's starter prompts, never offer something you already did this turn, and never name a person or record you did not see in a tool result.",
    "Skip it entirely for a greeting, a one-line factual answer, a refusal, or a turn that ends in a question to the user - an empty chip strip is better than filler.",
    "This writes nothing, changes nothing, and is not how you propose a durable Action - that is `suggest_general_action`. The suggestions are shown to the user as buttons, so do not list them in your reply as well.",
  ].join("\n"),
  inputSchema,
  async execute(input) {
    const accepted: string[] = [];
    const seen = new Set<string>();

    for (const raw of input.suggestions) {
      const suggestion = acceptSuggestion(raw);
      if (suggestion === null) continue;

      // Two chips that differ only in case are one chip the user taps twice.
      const key = suggestion.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      accepted.push(suggestion);
      if (accepted.length === MAX_SUGGESTIONS) break;
    }

    return { suggestions: accepted };
  },
  /**
   * The model gets a receipt, not its own words back.
   *
   * Echoing the accepted suggestions into the model's context would cost tokens to
   * tell it what it just said and, worse, invite it to summarize them into the
   * reply - which is the one thing a chip strip must not be paired with. The count
   * is here so a turn where everything was dropped is legible as that rather than
   * as a silent success, and so the model does not try again on a strip the user
   * can already see.
   */
  toModelOutput(output) {
    const count = output.suggestions.length;
    return {
      type: "json" as const,
      value: {
        ok: true,
        count,
        guidance:
          count === 0
            ? "None of those could be shown as chips, so the user sees none. Do not call this again on this turn; just finish your reply."
            : "Do not restate the suggestions in prose.",
      },
    };
  },
});
