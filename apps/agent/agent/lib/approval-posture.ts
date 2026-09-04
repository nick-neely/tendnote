import type { EveApprovalMode } from "@tendnote/domain";

/**
 * What the model is told about this conversation's approval posture, and the
 * whole of it.
 *
 * ## Why the model is never told the tier map
 *
 * The paragraphs below speak in categories - saving, sharing, deleting, sending,
 * fetching, revealing - and never name a tool or a tier. A model that knew which
 * named tools auto-approve could reason about which one to reach for to get a
 * write past a review it expected; a model that only knows the shape of the line
 * cannot (ADR-0240). The tier declaration lives on the tool's gate, where the
 * policy reads it and the model does not.
 *
 * ## Why exactly one paragraph
 *
 * The static `base.md` bullet says some calls *may* pause. Which ones actually do
 * is a per-conversation fact - it depends on the owner's Approval Mode and on
 * whether the conversation has become a Tainted Conversation - so it is stated
 * once, at the top of the turn, in one paragraph rather than three hedged ones.
 */

/** Every gated call pauses: the default posture, and the fallback for anything unreadable. */
export const ASK_APPROVAL_POSTURE =
  "In this conversation, saving or changing a record pauses for the user's approval. " +
  "They see the exact call and answer it themselves; you cannot answer it for them, " +
  "and a decline is final for that turn. Do not announce a pause before making a call, " +
  "and do not ask permission in chat instead of calling the tool.";

/** The owner chose `trusted` and nothing untrusted has been read in this conversation. */
export const TRUSTED_APPROVAL_POSTURE =
  "In this conversation, reversible private saves and changes run immediately without " +
  "asking; sharing with the household, deleting, sending, exporting, fetching a web page, " +
  "and revealing restricted content still pause for the user's approval. Do not ask " +
  "permission in chat for a save that will simply run, and still never claim a call " +
  "succeeded before its result says so.";

/** Untrusted Content has been read here, so every gated call asks again. */
export const TAINTED_APPROVAL_POSTURE =
  "Web content was read earlier in this conversation, so every save, change, send, and " +
  "fetch pauses for the user's approval again for the rest of it. This is not an error " +
  "and not something you can turn off; a new conversation is the only way back. Keep " +
  "working normally and let each call ask.";

/**
 * The one paragraph this conversation gets. Taint wins over the mode, because a
 * Tainted Conversation asks again in both modes.
 */
export function approvalPostureInstruction(input: {
  readonly mode: EveApprovalMode;
  readonly tainted: boolean;
}): string {
  if (input.tainted) return TAINTED_APPROVAL_POSTURE;
  return input.mode === "trusted" ? TRUSTED_APPROVAL_POSTURE : ASK_APPROVAL_POSTURE;
}
