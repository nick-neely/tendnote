import type { AssetPersonLinkEntry, RelatedAssetLink } from "@tendnote/db/queries/assets";
import type { AssetLinkRelation } from "@tendnote/domain";
import { assetLinkRelationLabel, assetPersonRelationLabel } from "@tendnote/domain";
import type { OwnerActionResult } from "./owner-action";

/**
 * Result of a link mutation server action (#202): links carry no editable view of
 * their own — the profile re-renders from the server on success — so `ok` is the
 * whole story (the null view keeps the shared submit runner happy), plus the
 * curated message when validation refuses.
 */
export type AssetLinkMutationResult = OwnerActionResult<null>;

/**
 * A Related Asset Link shaped for one profile's row (#202): the other asset's
 * name wrapped in a direction-aware sentence — outgoing reads "Fits
 * ‹Refrigerator›", incoming reads "‹Water filter› fits this" — so a link is one
 * plain phrase whichever side you're on.
 */
export type RelatedAssetLinkView = {
  linkId: string;
  otherAssetId: string;
  otherAssetName: string;
  relation: AssetLinkRelation;
  /** Sentence text before the linked name ("Fits " on the subject side). */
  phraseBefore: string;
  /** Sentence text after the linked name (" fits this" on the object side). */
  phraseAfter: string;
  /** True while the link is a pending suggestion awaiting the owner's review. */
  pending: boolean;
  /** Whether the viewer owns the link — only owners remove or review it. */
  owned: boolean;
};

/** Maps a link seam entry to its profile row view. */
export function toRelatedAssetLinkView(entry: RelatedAssetLink): RelatedAssetLinkView {
  const relationLabel = assetLinkRelationLabel(entry.relation);
  const outgoing = entry.direction === "outgoing";
  return {
    linkId: entry.linkId,
    otherAssetId: entry.otherAsset.id,
    otherAssetName: entry.otherAsset.name,
    relation: entry.relation,
    phraseBefore: outgoing
      ? `${relationLabel.charAt(0).toUpperCase()}${relationLabel.slice(1)} `
      : "",
    phraseAfter: outgoing ? "" : ` ${relationLabel} this`,
    pending: entry.pending,
    owned: entry.owned,
  };
}

/** An Asset Person Link shaped for a profile row: "‹Marcus› — borrowed it". */
export type AssetPersonLinkView = {
  linkId: string;
  personId: string;
  displayName: string;
  relationLabel: string;
};

/** Maps a person-link seam entry to its profile row view. */
export function toAssetPersonLinkView(entry: AssetPersonLinkEntry): AssetPersonLinkView {
  return {
    linkId: entry.linkId,
    personId: entry.person.id,
    displayName: entry.person.displayName,
    relationLabel: assetPersonRelationLabel(entry.relation),
  };
}
