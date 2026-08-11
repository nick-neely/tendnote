import type { AssetReviewGroupResult } from "@tendnote/db/queries/assets";
import type { AssetKind, AssetMemoryValue, AssetOwnership, PrivacyScope } from "@tendnote/domain";
import { assetLabelForKind } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";
import { type AssetEvidenceView, toAssetEvidenceView } from "./asset-evidence-view";
import { formatAssetMemoryValue } from "./asset-memory-value";

/**
 * Serializable, fixed-shape view of an Asset Review Group for the shared Review
 * Queue (#198). References persisted ids only (ADR 0028): every accept / edit /
 * dismiss / link reloads authoritative records server-side, so a refresh never
 * desyncs a proposal. One view = one review unit — the group is reviewed
 * together, resolved member by member or in one batch.
 */
export type AssetReviewGroupView = {
  groupId: string;
  /** The group's anchor: a pending Suggested Asset or the existing/linked Asset. */
  asset: {
    id: string;
    name: string;
    kind: AssetKind;
    kindLabel: string;
    scope: PrivacyScope;
    visibilityLabel: string;
    /**
     * The anchor's ownership form, so the card can tell "shared with the household"
     * apart from "is the household's" — only the first is an audience worth naming
     * (ADR 0214).
     */
    ownership: AssetOwnership;
    /** True while the anchor itself is still a pending proposal. */
    pending: boolean;
  };
  memories: AssetReviewMemoryView[];
  /** Evidence captured into this group — reviewed alongside what it grounds (#200). */
  evidence: AssetEvidenceView[];
  /** Existing assets the pending anchor likely duplicates — the link prompt. */
  duplicates: Array<{ id: string; name: string; kindLabel: string }>;
  source: { id: string; content: string; sourceType: string; capturedAt: string } | null;
  /**
   * The General Action this proposal was promoted from (#199), so the card can
   * ground an action-hint promotion even when it carries no source record. Null
   * for proposals that did not come from an action hint.
   */
  fromAction: { id: string; title: string } | null;
  /** Pending members left to review: the anchor (if pending) plus each memory. */
  pendingCount: number;
};

/** One Suggested Asset Memory, with its typed value split for display and edit. */
export type AssetReviewMemoryView = {
  id: string;
  label: string;
  value: AssetMemoryValue | null;
  /** The typed value formatted for reading ("Mar 14, 2026", "$42.99"); null when freeform. */
  valueLabel: string | null;
  notes: string | null;
};

function toAssetReviewMemoryView(memory: {
  id: string;
  label: string;
  value: AssetMemoryValue | null;
  notes: string | null;
}): AssetReviewMemoryView {
  return {
    id: memory.id,
    label: memory.label,
    value: memory.value,
    valueLabel: formatAssetMemoryValue(memory.value),
    notes: memory.notes,
  };
}

export function toAssetReviewGroupView(
  result: AssetReviewGroupResult,
  options: { fromAction?: { id: string; title: string } | null } = {},
): AssetReviewGroupView {
  return {
    groupId: result.group.id,
    asset: {
      id: result.asset.id,
      name: result.asset.name,
      kind: result.asset.kind,
      kindLabel: assetLabelForKind(result.asset.kind),
      scope: result.asset.scope,
      visibilityLabel: visibilityLabelForScope(result.asset.scope),
      ownership: result.asset.ownership,
      pending: result.assetPending,
    },
    memories: result.memories.map(toAssetReviewMemoryView),
    // Review is owner-only, so the group's owner is always the viewing caller.
    evidence: result.evidence.map((record) =>
      toAssetEvidenceView(record, { callerUserId: result.group.ownerUserId }),
    ),
    duplicates: result.duplicateCandidates.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kindLabel: assetLabelForKind(asset.kind),
    })),
    source: result.sourceRecord
      ? {
          id: result.sourceRecord.id,
          content: result.sourceRecord.content,
          sourceType: result.sourceRecord.sourceType,
          capturedAt: result.sourceRecord.createdAt.toISOString(),
        }
      : null,
    fromAction: options.fromAction ?? null,
    pendingCount: result.memories.length + (result.assetPending ? 1 : 0),
  };
}
