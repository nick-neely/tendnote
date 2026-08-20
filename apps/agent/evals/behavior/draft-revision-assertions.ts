/**
 * Canonical confirmations for the text-only draft edit seam.
 *
 * The edit tool returns the authoritative status. The reply contract mirrors that
 * state in one anchored shape, so a negation or history phrase cannot conceal an
 * additional claim in another sentence.
 */
export type EditableDraftStatus = "draft" | "approved";

const CANONICAL_CONFIRMATIONS: Record<EditableDraftStatus, RegExp> = {
  draft:
    /^Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft\.$/i,
  approved:
    /^Updated the internal Tendnote draft; its prior approval no longer covers this wording, nothing was exported or sent, and it is not an external or Gmail draft\.$/i,
};

/** True only for the canonical confirmation matching the tool's returned status. */
export function isDraftRevisionReplyCanonical(reply: string, status: EditableDraftStatus) {
  return CANONICAL_CONFIRMATIONS[status].test(reply.trim());
}
