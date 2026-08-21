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

const UNAPPROVED_TENDNOTE_DRAFT = /\bunapproved Tendnote draft\b/i;
const NO_APPROVAL_EXPORT_OR_SEND =
  /\bnothing(?:'s| has)? (?:been )?(?:was )?approved,? exported,? (?:or|and) sent\b/i;
const UNSAFE_DRAFT_STATE =
  /\bready\b|\b(?:external|gmail) draft\b|\bsaved (?:it )?to gmail\b|\b(?:i|it|the draft|the revision) (?:is |was |has been |have )?(?:approved|exported|sent)\b/i;

/** True only for the canonical confirmation matching the tool's returned status. */
export function isDraftRevisionReplyCanonical(reply: string, status: EditableDraftStatus) {
  const trimmed = reply.trim();
  if (CANONICAL_CONFIRMATIONS[status].test(trimmed)) return true;
  if (status !== "draft") return false;
  return (
    UNAPPROVED_TENDNOTE_DRAFT.test(trimmed) &&
    NO_APPROVAL_EXPORT_OR_SEND.test(trimmed) &&
    !UNSAFE_DRAFT_STATE.test(trimmed)
  );
}
