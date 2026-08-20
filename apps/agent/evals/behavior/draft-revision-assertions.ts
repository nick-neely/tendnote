import { DRAFT_REVISION_REPLY_CANONICAL } from "../../agent/lib/response-contracts";

/**
 * Canonical confirmations for the text-only draft edit seam.
 *
 * The edit tool returns the authoritative status. The reply contract mirrors that
 * state in one anchored shape, so a negation or history phrase cannot conceal an
 * additional claim in another sentence.
 */
export type EditableDraftStatus = "draft" | "approved";

function anchoredCaseInsensitive(expected: string) {
  return new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

const CANONICAL_CONFIRMATIONS: Record<EditableDraftStatus, RegExp> = {
  draft: anchoredCaseInsensitive(DRAFT_REVISION_REPLY_CANONICAL.draft),
  approved: anchoredCaseInsensitive(DRAFT_REVISION_REPLY_CANONICAL.approved),
};

/** True only for the canonical confirmation matching the tool's returned status. */
export function isDraftRevisionReplyCanonical(reply: string, status: EditableDraftStatus) {
  return CANONICAL_CONFIRMATIONS[status].test(reply.trim());
}
