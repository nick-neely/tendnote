import { ASSISTANT_CONVERSATION_STARTERS } from "@/lib/assistant/starters";
import type { AssistantToolView } from "./tool-result-view";

/**
 * The two or three things a person plausibly wants next, offered as chips under
 * the last finished turn.
 *
 * There are two sources, in that order of authority.
 *
 * The model's own, through the `suggest_next_steps` tool: it has just read the
 * answer it wrote, so it knows things the result kinds cannot - that the reply
 * left a question open, that one of three people named is the interesting one.
 * The old objection to letting the model write these was that a chip could name
 * an action the app cannot perform; that is answered upstream, where the tool's
 * instructions bound it to ordinary conversational turns, and a chip is only ever
 * a message sent back into the same conversation. It cannot do anything the
 * reader could not have typed.
 *
 * The kind-derived list below is the fallback for the turns where the model said
 * nothing at all. It is deliberately not a *supplement*: mixing invented and
 * derived chips would put the model's best guess next to a generic one and make
 * the pair read as equally considered.
 *
 * Either way, anything the reader has already said in this thread is struck out.
 * Offering someone a question they asked two turns ago is the conversation
 * forgetting itself, and the same goes for the starters that opened it.
 *
 * An empty list is a common, correct answer - a turn that saved a memory has
 * already finished the thought, and three chips inviting the user to keep going
 * would be nagging.
 */

/** The most chips shown under one turn. */
const MAX_FOLLOW_UP_SUGGESTIONS = 3;

/**
 * One suggestion reduced to what makes two of them the same question. Case and
 * punctuation carry no intent here: "Who should I reach out to this week?" and
 * "who should I reach out to this week" are one chip, and offering the second
 * after the reader sent the first is the failure this exists to prevent.
 */
function askedAlready(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The person this turn was about, if it was about one. First name wins: the
 * chips read as speech ("Draft a check-in to Priya Shah") and the turn is about
 * whoever the turn named first, not whoever happens to sort first.
 */
function turnPersonName(views: readonly AssistantToolView[]): string | null {
  for (const view of views) {
    switch (view.kind) {
      case "person_context":
      case "saved_memory":
      case "suggested_memory_review":
      case "suggested_followup_review":
        if (view.personName) return view.personName;
        break;
      case "added_person":
      case "updated_person":
        return view.displayName;
      default:
        break;
    }
  }
  return null;
}

/** The chips one result kind offers, given the person the turn named. */
function suggestionsForView(view: AssistantToolView, personName: string | null): string[] {
  switch (view.kind) {
    // A recall of one person is the turn most likely to be a prelude to acting
    // on them, so the chips are the two acts the assistant can actually take.
    case "person_context":
      return personName
        ? [`Draft a check-in to ${personName}`, `Add a follow-up for ${personName}`]
        : [];
    // A draft is on screen and editable; the useful next asks are revisions of
    // it, which the drafting tools already support.
    case "message_draft":
    case "draft_proposal":
      return ["Make it shorter", "Make it warmer"];
    // Something was just written down. The natural next question is what else is
    // already known about them - which is a plain recall, not a new save.
    case "saved_memory":
    case "saved_source_record":
      return personName ? [`What else do I know about ${personName}?`] : [];
    // A list of what is due invites the same question one level up.
    case "relationship_agenda":
    case "general_action_list":
      return ["Who should I reach out to this week?"];
    default:
      return [];
  }
}

/** The chips the turn's own results imply, in the order the turn produced them. */
function suggestionsFromViews(views: readonly AssistantToolView[]): string[] {
  const personName = turnPersonName(views);
  const suggestions: string[] = [];

  for (const view of views) {
    for (const suggestion of suggestionsForView(view, personName)) {
      if (!suggestions.includes(suggestion)) {
        suggestions.push(suggestion);
      }
    }
  }

  return suggestions;
}

/**
 * Follow-up prompts for one finished turn: the model's own where it offered any,
 * else the ones its results imply — minus anything already asked, deduplicated,
 * and capped at three.
 */
export function followUpSuggestions({
  asked = [],
  proposed,
  views,
}: {
  /** Every message the reader has sent in this thread. */
  readonly asked?: readonly string[];
  /**
   * What the model proposed, or `null`/`undefined` when it proposed nothing. An
   * empty array is the model's own "nothing useful comes next" and is respected
   * as such - it does *not* fall through to the derived list.
   */
  readonly proposed?: readonly string[] | null;
  readonly views: readonly AssistantToolView[];
}): string[] {
  const offered = proposed ?? suggestionsFromViews(views);
  const spent = new Set(
    [...asked, ...ASSISTANT_CONVERSATION_STARTERS].map(askedAlready).filter(Boolean),
  );
  const suggestions: string[] = [];

  for (const raw of offered) {
    const suggestion = raw.trim();
    const key = askedAlready(suggestion);
    if (!key || spent.has(key)) {
      continue;
    }
    spent.add(key);
    suggestions.push(suggestion);
    if (suggestions.length === MAX_FOLLOW_UP_SUGGESTIONS) {
      break;
    }
  }

  return suggestions;
}
