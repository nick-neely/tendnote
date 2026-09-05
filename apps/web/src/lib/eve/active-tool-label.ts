import { humanizeToolName, specialistToolName } from "./tool-name";

/**
 * Human copy for one Eve tool call, in the two tenses a turn needs it: the
 * present-continuous line while the call runs, and the past-tense line the
 * activity disclosure keeps once the turn is over ("Searching people…" →
 * "Searched people").
 *
 * This is a property of the *call*, not of a persisted result kind: it covers
 * tools that never render a typed result (a people search, a prose-only General
 * Action mutation) as well as every rendered one, so it stays a flat tool-name →
 * copy table rather than folding into the result-module registry. Both tenses
 * live in one entry so they cannot drift apart - a tool whose working line says
 * "Saving to memory…" must not settle into an unrelated phrase.
 *
 * A tool absent from the table falls back to its slugified name. That fallback
 * is the reason the table is worth its length: "search_people" must never reach
 * the transcript, and "Search people" is the least-bad thing to say about a tool
 * nobody has written copy for yet.
 */
const TOOL_LABELS: Record<string, readonly [active: string, done: string]> = {
  // Eve's own namespaced built-in, which loads the instructions for the kind of
  // task at hand. It reached the transcript as "Eve:load-skill" — the framework
  // naming itself to a reader, which the product never does — and the copy says
  // what it is *for* rather than what it loads, because the reader has no model
  // of a "skill" and does not need one.
  "eve:load-skill": ["Getting up to speed…", "Got up to speed"],
  web_search: ["Searching the web…", "Searched the web"],
  web_fetch: ["Looking that up on the web…", "Read a web page"],
  search_people: ["Searching people…", "Searched people"],
  search_relationship_context: ["Searching your notebook…", "Searched your notebook"],
  // The cross-domain search: it looks everywhere, so it says so rather than naming
  // one record family the answer might not come from.
  search_global_recall: ["Searching your records…", "Searched your records"],
  search_semantic_context: ["Searching by meaning…", "Searched by meaning"],
  get_relationship_agenda: [
    "Checking your relationship agenda…",
    "Checked your relationship agenda",
  ],
  propose_memory_cleanup: [
    "Reviewing memory cleanup candidates…",
    "Reviewed memory cleanup candidates",
  ],
  propose_message_draft: ["Drafting options…", "Drafted options"],
  get_person_context: ["Recalling…", "Recalled what you know"],
  get_suggested_memory_review: ["Checking for suggestions…", "Checked for suggestions"],
  list_suggested_memory_reviews: [
    "Gathering suggestions to review…",
    "Gathered suggestions to review",
  ],
  propose_followup: ["Drafting a follow-up to review…", "Drafted a follow-up to review"],
  get_suggested_followup_review: ["Checking suggested follow-ups…", "Checked suggested follow-ups"],
  list_suggested_followup_reviews: [
    "Gathering follow-ups to review…",
    "Gathered follow-ups to review",
  ],
  accept_suggested_followup: ["Setting the reminder…", "Set the reminder"],
  dismiss_suggested_followup: ["Dismissing the suggestion…", "Dismissed the suggestion"],
  create_followup: ["Setting a reminder…", "Set a reminder"],
  list_due_followups: ["Checking what's due…", "Checked what's due"],
  update_followup_status: ["Updating the reminder…", "Updated the reminder"],
  capture_source_record: ["Logging…", "Logged it"],
  capture_memory: ["Saving to memory…", "Saved to memory"],
  create_message_draft: ["Drafting a message…", "Drafted a message"],
  create_person: ["Adding to your notebook…", "Added to your notebook"],
  undo_person_update: ["Undoing the profile update…", "Checked profile undo"],
  update_person: ["Updating the profile…", "Updated the profile"],
  create_general_action: ["Adding to your actions…", "Added to your actions"],
  suggest_general_action: ["Drafting a suggested action…", "Drafted a suggested action"],
  plan_suggested_general_actions: ["Sketching a few steps…", "Sketched a few steps"],
  list_general_actions: ["Checking your actions…", "Checked your actions"],
  list_general_action_areas: ["Checking your areas…", "Checked your areas"],
  get_suggested_general_action_review: [
    "Pulling up the suggested action…",
    "Pulled up the suggested action",
  ],
  list_suggested_general_action_reviews: [
    "Gathering actions to review…",
    "Gathered actions to review",
  ],
  propose_asset_actions: ["Checking what this asset needs…", "Checked what this asset needs"],
  propose_asset_memories: ["Putting that up for review…", "Put that up for review"],
  propose_suggested_memory: ["Putting that up for review…", "Put that up for review"],
  approve_suggested_memory: ["Saving it as a fact…", "Saved it as a fact"],
  dismiss_suggested_memory: ["Dismissing the suggestion…", "Dismissed the suggestion"],
  // Prose mutation tools render no card, but still get hand-written copy rather than
  // a slugified tool name.
  accept_suggested_general_action: ["Adding it to your list…", "Added it to your list"],
  dismiss_suggested_general_action: ["Dismissing the suggestion…", "Dismissed the suggestion"],
  edit_general_action: ["Updating the action…", "Updated the action"],
  update_general_action_status: ["Updating the action…", "Updated the action"],
  archive_memory: ["Archiving the memory…", "Archived the memory"],
  edit_draft_body: ["Revising the draft…", "Revised the draft"],
  dismiss_draft: ["Throwing the draft away…", "Threw the draft away"],
  // Saving to Gmail is the one label that names the outside world, because it is the
  // one call that reaches it - and it still only ever writes a draft there.
  save_draft_to_gmail: ["Saving the draft to Gmail…", "Saved the draft to Gmail"],
  search_assets: ["Searching your things…", "Searched your things"],
  get_asset_context: ["Pulling up what you know about it…", "Pulled up what you know about it"],
  create_asset: ["Adding it to your things…", "Added it to your things"],
  // Not "Renaming it…": this edits the name *or* the kind, and a label that promises
  // a rename is wrong half the time it shows.
  edit_asset: ["Updating it…", "Updated it"],
  // Self context: what the assistant knows about the user themselves.
  remember_self_context: ["Noting that about you…", "Noted that about you"],
  update_self_context: ["Updating what you told me…", "Updated what you told me"],
  get_self_context_fact: ["Checking what you told me…", "Checked what you told me"],
  list_self_context: ["Checking what you told me…", "Checked what you told me"],
  archive_self_context: ["Putting that aside…", "Put that aside"],
  restore_self_context: ["Bringing that back…", "Brought that back"],
  // Read-only Calendar, and the sandbox that parses pasted text without writing.
  list_calendar_events: ["Checking your calendar…", "Checked your calendar"],
  cleanup_preview: ["Sorting through that…", "Sorted through that"],
  // Household surfaces. The wording stays about records rather than about people:
  // "checking on the household" would read as checking up on whoever is in it.
  household_check_in: [
    "Checking what your household is coordinating…",
    "Checked what your household is coordinating",
  ],
  capture_saved_item: ["Saving…", "Saved it"],
  change_saved_item_capture: ["Correcting what was saved…", "Corrected what was saved"],
  undo_saved_item_capture: ["Undoing that…", "Undid that"],
  list_saved_items: ["Checking what you saved…", "Checked what you saved"],
  list_message_drafts: ["Checking your drafts…", "Checked your drafts"],
  // Never rendered: `suggest_next_steps` is a silent UI tool, filtered out of the
  // turn's activity, cards, and lines by `message-views.ts`. The entry exists so
  // the table stays exhaustive over the agent's authoring surface — if the tool
  // ever stopped being silent, the fallback would put "suggest next steps…" in
  // front of a reader, and the test that walks `agent/tools` is what catches that.
  suggest_next_steps: ["Thinking about what's next…", "Thought about what's next"],
  search_gift_plans: ["Checking your gift plans…", "Checked your gift plans"],
  get_gift_plan: ["Opening the gift plan…", "Opened the gift plan"],
  add_gift_idea: ["Adding the idea to the plan…", "Added the idea to the plan"],
  edit_gift_idea: ["Updating the idea…", "Updated the idea"],
  remove_gift_idea: ["Taking the idea off the plan…", "Took the idea off the plan"],
};

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Present-continuous label for an in-flight tool call (the shimmer line). */
export function activeToolLabel(toolName: string): string {
  if (specialistToolName(toolName))
    return `${sentenceCase(humanizeToolName(toolName))} is helping…`;
  return TOOL_LABELS[toolName]?.[0] ?? `${humanizeToolName(toolName)}…`;
}

/** Past-tense label for a settled tool call (the activity disclosure's step). */
export function completedToolLabel(toolName: string): string {
  if (specialistToolName(toolName)) return `${sentenceCase(humanizeToolName(toolName))} finished`;
  return TOOL_LABELS[toolName]?.[1] ?? sentenceCase(humanizeToolName(toolName));
}
