import { type AssetMemory, AssetValidationError } from "@tendnote/domain";
import { recordAudit, resolveAssetVisibility } from "./lifecycle";
import {
  buildGroupResult,
  openSuggestedAssetProposal,
  requireActiveAnchor,
  requireGrounding,
  writeSuggestedMemory,
} from "./review-shared";
import type {
  AssetReviewGroupResult,
  AssetReviewLifecycleStore,
  CreateActiveAssetMemoryInput,
  SuggestAssetInput,
  SuggestAssetMemoriesInput,
} from "./review-types";
import { resolveAssetChildVisibility, writeAssetChildShares } from "./review-visibility";

/**
 * The write entry points for Asset Memory (#198): inferred context enters as
 * review-gated Suggested rows in an Asset Review Group; explicit user intent
 * creates a durable active memory directly. Extraction (#199) and Eve (#200)
 * feed the suggest paths.
 */

/**
 * Proposes a Suggested Asset (with optional Suggested Asset Memories) from one
 * grounded source context, opening an Asset Review Group. The asset row is
 * `suggested` — owner-only and absent from every durable surface — and its
 * argued visibility is private or household; a selected-shared audience is
 * chosen at acceptance. Restricted context never feeds a proactive proposal
 * unless the user asked directly (ADRs 0058, 0151).
 */
export async function suggestAsset(
  store: AssetReviewLifecycleStore,
  input: SuggestAssetInput,
): Promise<AssetReviewGroupResult> {
  const sourceRecord = await requireGrounding(store, input);
  const { scope, householdId } = await resolveAssetVisibility(store, {
    ownerUserId: input.ownerUserId,
    scope: input.scope,
    householdId: input.householdId,
  });

  // Inferred proposals default to `system` provenance; Eve passes `assistant`.
  const auditSource = input.source ?? "system";
  const { asset, group } = await openSuggestedAssetProposal(store, {
    ownerUserId: input.ownerUserId,
    actorUserId: input.ownerUserId,
    name: input.name,
    kind: input.kind,
    scope,
    householdId,
    sourceRecordId: sourceRecord.id,
    auditSource,
    auditDetail: { memoriesSuggested: input.memories?.length ?? 0 },
  });

  for (const content of input.memories ?? []) {
    await writeSuggestedMemory(store, {
      ownerUserId: input.ownerUserId,
      anchor: asset,
      groupId: group.id,
      sourceRecordId: sourceRecord.id,
      content,
      auditSource,
    });
  }

  return buildGroupResult(store, group);
}

/**
 * Proposes Suggested Asset Memories for an Asset the suggester already has (or
 * can see), opening a review group anchored to that durable asset — no
 * duplicate asset row, so no duplicate prompt. The anchor must be active:
 * archived assets are read-only history.
 */
export async function suggestAssetMemories(
  store: AssetReviewLifecycleStore,
  input: SuggestAssetMemoriesInput,
): Promise<AssetReviewGroupResult> {
  const sourceRecord = await requireGrounding(store, input);
  if (input.memories.length === 0) {
    throw new AssetValidationError("Suggest at least one detail.");
  }
  const anchor = await requireActiveAnchor(store, input.ownerUserId, input.assetId);

  const group = await store.createAssetReviewGroup({
    ownerUserId: input.ownerUserId,
    assetId: anchor.id,
    sourceRecordId: sourceRecord.id,
  });

  for (const content of input.memories) {
    await writeSuggestedMemory(store, {
      ownerUserId: input.ownerUserId,
      anchor,
      groupId: group.id,
      sourceRecordId: sourceRecord.id,
      content,
      auditSource: input.source ?? "system",
    });
  }

  return buildGroupResult(store, group);
}

/**
 * Creates a durable, active Asset Memory from explicit user intent (#196) — the
 * direct path that never needs review. The child-scope ceiling still applies,
 * and the write lands in the asset's audit trail.
 */
export async function createActiveAssetMemory(
  store: AssetReviewLifecycleStore,
  input: CreateActiveAssetMemoryInput,
): Promise<AssetMemory> {
  const anchor = await requireActiveAnchor(store, input.ownerUserId, input.assetId);

  const visibility = await resolveAssetChildVisibility(store, {
    ownerUserId: input.ownerUserId,
    anchor,
    // Explicit creation remains private unless the user widens it.
    scope: input.scope ?? "private",
    selectedUserIds: input.selectedUserIds,
  });

  const memory = await store.createAssetMemory({
    assetId: anchor.id,
    ownerUserId: input.ownerUserId,
    status: "active",
    label: input.label,
    value: input.value ?? null,
    notes: input.notes ?? null,
    scope: visibility.scope,
    householdId: visibility.householdId,
    sourceRecordId: input.sourceRecordId ?? null,
    reviewGroupId: null,
    createdByUserId: input.ownerUserId,
    lastActorUserId: input.ownerUserId,
  });

  await writeAssetChildShares(store, {
    ...visibility,
    ownerUserId: input.ownerUserId,
    recordKind: "asset_memory",
    recordId: memory.id,
  });

  await recordAudit(store, anchor, {
    kind: "memory_created",
    actorUserId: input.ownerUserId,
    source: input.source ?? "user",
    detail: { memoryId: memory.id, label: memory.label, scope: memory.scope },
  });

  return memory;
}
