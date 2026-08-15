import { humanizeToolName } from "./tool-name";

/**
 * Present-continuous labels for an in-flight Eve tool call — the shimmer line shown
 * before any result exists. This is a property of the *call*, not of a persisted
 * result kind: it covers tools that never render a typed result (a people search, a
 * prose-only General Action mutation) as well as every rendered one, so it stays a
 * flat tool-name → label table rather than folding into the result-module registry.
 * A tool absent from the table falls back to its slugified name.
 */
const ACTIVE_TOOL_LABELS: Record<string, string> = {
  search_people: "Searching people…",
  search_relationship_context: "Searching your notebook…",
  // The cross-domain search: it looks everywhere, so it says so rather than naming
  // one record family the answer might not come from.
  search_global_recall: "Searching your records…",
  search_semantic_context: "Searching by meaning…",
  get_relationship_agenda: "Checking your relationship agenda…",
  propose_memory_cleanup: "Reviewing memory cleanup candidates…",
  propose_message_draft: "Drafting options…",
  get_person_context: "Recalling…",
  get_suggested_memory_review: "Checking for suggestions…",
  list_suggested_memory_reviews: "Gathering suggestions to review…",
  propose_followup: "Drafting a follow-up to review…",
  get_suggested_followup_review: "Checking suggested follow-ups…",
  list_suggested_followup_reviews: "Gathering follow-ups to review…",
  accept_suggested_followup: "Setting the reminder…",
  dismiss_suggested_followup: "Dismissing the suggestion…",
  create_followup: "Setting a reminder…",
  list_due_followups: "Checking what's due…",
  update_followup_status: "Updating the reminder…",
  capture_source_record: "Logging…",
  capture_memory: "Saving to memory…",
  create_message_draft: "Drafting a message…",
  create_person: "Adding to your notebook…",
  update_person: "Updating the profile…",
  create_general_action: "Adding to your actions…",
  suggest_general_action: "Drafting a suggested action…",
  plan_suggested_general_actions: "Sketching a few steps…",
  list_general_actions: "Checking your actions…",
  list_general_action_areas: "Checking your areas…",
  get_suggested_general_action_review: "Pulling up the suggested action…",
  list_suggested_general_action_reviews: "Gathering actions to review…",
  propose_asset_actions: "Checking what this asset needs…",
  propose_asset_memories: "Putting that up for review…",
  propose_suggested_memory: "Putting that up for review…",
  approve_suggested_memory: "Saving it as a fact…",
  dismiss_suggested_memory: "Dismissing the suggestion…",
  // Prose mutation tools render no card, but still shimmer with a hand-written label
  // rather than a slugified tool name while they run.
  accept_suggested_general_action: "Adding it to your list…",
  dismiss_suggested_general_action: "Dismissing the suggestion…",
  edit_general_action: "Updating the action…",
  update_general_action_status: "Updating the action…",
  archive_memory: "Archiving the memory…",
  edit_draft_body: "Revising the draft…",
  dismiss_draft: "Throwing the draft away…",
  // Saving to Gmail is the one label that names the outside world, because it is the
  // one call that reaches it - and it still only ever writes a draft there.
  save_draft_to_gmail: "Saving the draft to Gmail…",
  search_assets: "Searching your things…",
  get_asset_context: "Pulling up what you know about it…",
  create_asset: "Adding it to your things…",
  // Not "Renaming it…": this edits the name *or* the kind, and a label that promises
  // a rename is wrong half the time it shows.
  edit_asset: "Updating it…",
  // Self context: what Eve knows about the user themselves.
  remember_self_context: "Noting that about you…",
  update_self_context: "Updating what you told me…",
  get_self_context_fact: "Checking what you told me…",
  list_self_context: "Checking what you told me…",
  archive_self_context: "Putting that aside…",
  restore_self_context: "Bringing that back…",
  // Read-only Calendar, and the sandbox that parses pasted text without writing.
  list_calendar_events: "Checking your calendar…",
  cleanup_preview: "Sorting through that…",
  // Household surfaces. The wording stays about records rather than about people:
  // "checking on the household" would read as checking up on whoever is in it.
  household_check_in: "Checking what your household is coordinating…",
  capture_saved_item: "Saving…",
  change_saved_item_capture: "Correcting what was saved…",
  undo_saved_item_capture: "Undoing that…",
  list_saved_items: "Checking what you saved…",
  list_message_drafts: "Checking your drafts…",
  search_gift_plans: "Checking your gift plans…",
  get_gift_plan: "Opening the gift plan…",
  add_gift_idea: "Adding the idea to the plan…",
  edit_gift_idea: "Updating the idea…",
  remove_gift_idea: "Taking the idea off the plan…",
};

/** Present-continuous label for an in-flight tool call (the shimmer line). */
export function activeToolLabel(toolName: string): string {
  return ACTIVE_TOOL_LABELS[toolName] ?? `${humanizeToolName(toolName)}…`;
}
