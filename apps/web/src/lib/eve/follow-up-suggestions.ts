import type { AssistantToolView } from "./tool-result-view";

/**
 * The two or three things a person plausibly wants next, offered as chips under
 * the last finished turn.
 *
 * These are derived from what the turn *did*, never from the model's prose: a
 * suggestion the model wrote could invent an action the app cannot perform, and
 * a chip that fails when tapped is worse than no chip. Every line here maps to
 * an ordinary conversational turn the assistant already handles.
 *
 * Kinds with nothing obvious to offer contribute nothing. An empty list is the
 * common, correct answer - a turn that saved a memory has already finished the
 * thought, and three chips inviting the user to keep going would be nagging.
 */

/** The most chips shown under one turn. */
const MAX_FOLLOW_UP_SUGGESTIONS = 3;

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

/**
 * Follow-up prompts for one finished turn, in the order the turn produced its
 * results, deduplicated and capped at three.
 */
export function followUpSuggestions(views: readonly AssistantToolView[]): string[] {
  const personName = turnPersonName(views);
  const suggestions: string[] = [];

  for (const view of views) {
    for (const suggestion of suggestionsForView(view, personName)) {
      if (suggestions.includes(suggestion)) {
        continue;
      }
      suggestions.push(suggestion);
      if (suggestions.length === MAX_FOLLOW_UP_SUGGESTIONS) {
        return suggestions;
      }
    }
  }

  return suggestions;
}
