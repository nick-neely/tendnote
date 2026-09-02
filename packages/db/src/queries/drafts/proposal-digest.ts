import { createHash } from "node:crypto";
import type { DraftSourceRef } from "@tendnote/domain";

/**
 * The content binding between a Draft Proposal and the durable draft made from it.
 *
 * A proposal is ephemeral by design (ADR 0125): nothing is stored, so the wording
 * the owner chose and the provenance behind it travel back to
 * `create_message_draft` through the model. `persistAcceptedDraftProposal` used to
 * write whatever arrived and stamp it `message_draft.accepted_proposal`, which made
 * that audit entry a claim nobody had checked - a body could be rewritten, a source
 * reference invented, and the record would still say the owner accepted it.
 *
 * The digest closes that gap without a table: the generator stamps each variant
 * with a hash of its body and the proposal's references, the persist step recomputes
 * it from what it was handed, and a mismatch is refused before anything is written.
 *
 * What it is not: a capability. A hash travels in the clear and proves only that
 * this text was issued together, not that anyone accepted it - the owner approval on
 * `create_message_draft` is what proves that. The two are complementary: the
 * approval binds the write to a person's decision, the digest binds it to the words
 * they were shown.
 *
 * Every field of every reference is covered, in order, so a relabelled or re-trusted
 * reference fails the same way an edited body does. The reference count leads and a
 * NUL separates every field, so no rearrangement of the parts hashes to the same
 * string as a different proposal.
 */
export function draftProposalDigest(input: {
  body: string;
  sourceRefs: readonly DraftSourceRef[];
}): string {
  const parts = [
    input.body,
    String(input.sourceRefs.length),
    ...input.sourceRefs.flatMap((ref) => [ref.kind, ref.id, ref.label, ref.trust]),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/**
 * Whether a supplied digest matches the body and references it claims to describe.
 *
 * Compared as plain strings: both sides are derived from data the caller already
 * holds, so there is no secret here for a timing comparison to protect.
 */
export function draftProposalDigestMatches(input: {
  body: string;
  sourceRefs: readonly DraftSourceRef[];
  digest: string;
}): boolean {
  return draftProposalDigest(input) === input.digest;
}
