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
  // Prose mutation tools render no card, but still shimmer with a hand-written label
  // rather than a slugified tool name while they run.
  accept_suggested_general_action: "Adding it to your list…",
  dismiss_suggested_general_action: "Dismissing the suggestion…",
  edit_general_action: "Updating the action…",
  update_general_action_status: "Updating the action…",
  search_assets: "Searching your things…",
  get_asset_context: "Pulling up what you know about it…",
  // Household surfaces. The wording stays about records rather than about people:
  // "checking on the household" would read as checking up on whoever is in it.
  household_check_in: "Checking what your household is coordinating…",
  capture_saved_item: "Saving…",
  list_saved_items: "Checking what you saved…",
  list_message_drafts: "Checking your drafts…",
  search_gift_plans: "Checking your gift plans…",
  add_gift_idea: "Adding the idea to the plan…",
};

/** Present-continuous label for an in-flight tool call (the shimmer line). */
export function activeToolLabel(toolName: string): string {
  return ACTIVE_TOOL_LABELS[toolName] ?? `${humanizeToolName(toolName)}…`;
}
