import type { AssetKind, PrivacyScope } from "@tendnote/domain";

/**
 * Where a chat capture can land (#201): one of the caller's own active Assets,
 * or one of their still-open Asset Review Groups — the same two targets the
 * shared Asset Evidence Capture seam accepts (#200). Serializable views only;
 * the server action re-resolves authoritative records before any write.
 */
export type EvidenceDestinationAsset = {
  targetKind: "asset";
  id: string;
  name: string;
  kind: AssetKind;
  kindLabel: string;
  /** The anchor's visibility — household offers the "keep private" narrowing. */
  scope: PrivacyScope;
  visibilityLabel: string;
};

export type EvidenceDestinationReview = {
  targetKind: "review";
  groupId: string;
  /** The pending proposal's name — what the user will recognize it by. */
  assetName: string;
  kind: AssetKind;
  kindLabel: string;
  scope: PrivacyScope;
};

export type EvidenceDestination = EvidenceDestinationAsset | EvidenceDestinationReview;

/**
 * Where the user decided a chat capture lands (#201): an existing destination,
 * or something new that starts as a review-gated Suggested Asset.
 */
export type EvidenceCaptureChoice =
  | { kind: "existing"; destination: EvidenceDestination }
  | { kind: "new"; assetName: string; assetKind: AssetKind };

export type EvidenceDestinationResolution =
  /** Exactly one place this could land — preselect it, still confirmed by the user. */
  | { kind: "clear"; destination: EvidenceDestination }
  /** Several candidates — the user chooses; nothing is guessed (#196 story 26). */
  | { kind: "choose" }
  /** Nothing exists yet — the only path is naming something new, review-gated. */
  | { kind: "new_only" };

/**
 * Resolves whether a chat capture's destination is clear from context (#201).
 * Deliberately conservative: only a *sole* candidate counts as clear, and even
 * then the user confirms before anything writes — evidence is never silently
 * misfiled.
 */
export function resolveEvidenceDestination(
  candidates: EvidenceDestination[],
): EvidenceDestinationResolution {
  const [first, second] = candidates;
  if (first === undefined) {
    return { kind: "new_only" };
  }
  if (second === undefined) {
    return { kind: "clear", destination: first };
  }
  return { kind: "choose" };
}

/** Stable list key for a rendered destination row. */
export function evidenceDestinationKey(destination: EvidenceDestination): string {
  return destination.targetKind === "asset"
    ? `asset:${destination.id}`
    : `review:${destination.groupId}`;
}

/** The capture target the shared server action expects for this destination. */
export function evidenceDestinationTarget(
  destination: EvidenceDestination,
): { assetId: string } | { reviewGroupId: string } {
  return destination.targetKind === "asset"
    ? { assetId: destination.id }
    : { reviewGroupId: destination.groupId };
}
