/**
 * Which Eve tool calls a `trusted` Approval Mode or a Session Tool Trust can run
 * without asking: the Reversible Private Write tier (ADR-0240), as a list a
 * surface can read.
 *
 * ## Why the list is here rather than derived
 *
 * The authority is the declaration on each tool's own gate, in the agent, where
 * the policy reads it. A browser cannot see that: an approval request carries a
 * tool name and a frozen input and nothing about tiers. But the approval card has
 * one thing to decide that depends on it - whether to offer "Don't ask again for
 * this in this conversation" - and offering it on a call the policy will never
 * honour is a control that does nothing, which is worse than no control.
 *
 * So this is the same claim written once for the client, and
 * `apps/agent/tests/write-tool-approval.test.ts` asserts that the tuple below
 * equals the set of tools whose gate actually declares the tier. The two cannot
 * drift without that test failing, and it is the agent's behaviour that is
 * checked there, not this list quoting itself.
 *
 * ## What this is not
 *
 * Not an authorization. Nothing here decides whether a call runs: the policy does
 * that, from the tool's own declaration, the owner's Approval Mode read fresh
 * from the database, and whether the conversation is a Tainted Conversation. A
 * client that got this wrong would show or withhold one checkbox, never approve
 * anything.
 */

/**
 * Every tool whose gate declares itself a Reversible Private Write, sorted.
 *
 * A tool joins this tier by being owner-scoped or owner-created, private by
 * construction, and reversible by an undo, archive, restore, or lifecycle path.
 * The rule, and each tool's path back, are enforced in
 * `apps/agent/tests/write-tool-approval.test.ts`.
 */
export const REVERSIBLE_PRIVATE_WRITE_TOOL_NAMES = [
  "accept_suggested_followup",
  "accept_suggested_general_action",
  "approve_suggested_memory",
  "archive_memory",
  "archive_self_context",
  "capture_memory",
  "capture_saved_item",
  "capture_source_record",
  "change_saved_item_capture",
  "create_followup",
  "create_general_action",
  "create_person",
  "dismiss_suggested_followup",
  "dismiss_suggested_general_action",
  "dismiss_suggested_memory",
  "remember_self_context",
  "restore_self_context",
  "undo_saved_item_capture",
  "update_followup_status",
  "update_general_action_status",
  "update_person",
  "update_self_context",
] as const;

export type ReversiblePrivateWriteToolName = (typeof REVERSIBLE_PRIVATE_WRITE_TOOL_NAMES)[number];

/**
 * Whether *this* call is a Reversible Private Write, tool name and frozen input
 * together.
 *
 * One tool's tier depends on its arguments, and the predicate has to match the
 * agent's exactly: `capture_saved_item` is private only while `requestedScope` is
 * absent, because setting it is the one way a capture asks for an audience wider
 * than the owner. Any other spelling of a widening argument would be a new tier
 * predicate on the tool, and would have to be mirrored here.
 *
 * Pure and total: a missing or malformed input is read as "no arguments", which
 * for every other tool in the tier is the ordinary case.
 */
export function isReversiblePrivateWriteRequest(toolName: string, input: unknown): boolean {
  if (!(REVERSIBLE_PRIVATE_WRITE_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return false;
  }

  if (toolName === "capture_saved_item") {
    // Strictly `undefined`, which is what the agent's own predicate reads and what
    // the schema defaults the argument to. A present-but-null scope is a call that
    // named the argument, and the policy will ask about it.
    return (isRecord(input) ? input.requestedScope : undefined) === undefined;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
