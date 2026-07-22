import {
  type Asset,
  type AssetEvidence,
  AssetValidationError,
  assertAssetEvidenceFileAccepted,
  assertAssetEvidenceFileSignature,
} from "@tendnote/domain";
import type {
  AddAssetEvidenceInput,
  AddAssetEvidenceToNewAssetInput,
  AssetEvidenceFilePayload,
  RemoveAssetEvidenceInput,
} from "./evidence-types";
import { recordAudit } from "./lifecycle";
import {
  buildGroupResult,
  loadAnchor,
  openSuggestedAssetProposal,
  requireActiveAnchor,
  requireGroup,
  SET_ASIDE,
} from "./review-shared";
import type { AssetReviewGroupResult, AssetReviewLifecycleStore } from "./review-types";
import { resolveAssetChildVisibility, writeAssetChildShares } from "./review-visibility";

/**
 * The shared Asset Evidence Capture steps (#200): one write path whether
 * evidence arrives from the Asset Profile drop zone, mobile capture, the Review
 * Queue card, or (later) Eve's chat plus-menu (#201). Evidence attaches to an
 * existing active Asset, or to an Asset Review Group whose destination is still
 * under review — never to nowhere, so no document inbox can form.
 */

/**
 * Resolves the capture target to its anchor Asset. The direct path requires a
 * durable, active Asset; the review path accepts the group's anchor while it is
 * still a pending Suggested Asset (that is the point — evidence lands before the
 * destination is accepted), but never a dismissed husk or an archived asset.
 */
async function requireCaptureAnchor(
  store: AssetReviewLifecycleStore,
  input: AddAssetEvidenceInput,
): Promise<{ anchor: Asset; reviewGroupId: string | null }> {
  if ((input.assetId === undefined) === (input.reviewGroupId === undefined)) {
    throw new AssetValidationError("Attach evidence to exactly one asset or review item.");
  }

  if (input.assetId !== undefined) {
    return {
      anchor: await requireActiveAnchor(store, input.ownerUserId, input.assetId),
      reviewGroupId: null,
    };
  }

  const group = await requireGroup(store, {
    ownerUserId: input.ownerUserId,
    groupId: input.reviewGroupId as string,
  });
  const anchor = await loadAnchor(store, input.ownerUserId, group.assetId);
  if (!anchor) {
    throw new Error("Asset not found.");
  }
  if (anchor.status === "dismissed") {
    throw new AssetValidationError(SET_ASIDE);
  }
  if (anchor.status === "archived") {
    throw new AssetValidationError("This asset is archived. Restore it before adding evidence.");
  }
  return { anchor, reviewGroupId: group.id };
}

/**
 * Captures one piece of Asset Evidence: upload, link, or retained text, with
 * optional money/date metadata. The file is vetted before anything persists;
 * visibility defaults to the anchor's scope where supported and is enforced
 * against the child-scope ceiling fail-closed; the write lands in the anchor's
 * audit trail with capture provenance.
 */
export async function addAssetEvidence(
  store: AssetReviewLifecycleStore,
  input: AddAssetEvidenceInput,
): Promise<AssetEvidence> {
  const { anchor, reviewGroupId } = await requireCaptureAnchor(store, input);

  if (input.file) {
    assertAssetEvidenceFileAccepted(input.file);
    // The declared mime type is caller input (browser- or, later, Eve-supplied
    // #201) — verify the bytes' own signature before anything persists.
    assertAssetEvidenceFileSignature(input.file);
  }

  const visibility = await resolveAssetChildVisibility(store, {
    ownerUserId: input.ownerUserId,
    anchor,
    scope: input.scope,
    selectedUserIds: input.selectedUserIds,
  });

  const evidence = await store.createAssetEvidence({
    values: {
      assetId: anchor.id,
      ownerUserId: input.ownerUserId,
      kind: input.kind,
      label: input.label,
      fileName: input.file?.fileName ?? null,
      mimeType: input.file?.mimeType ?? null,
      sizeBytes: input.file?.sizeBytes ?? null,
      url: input.url ?? null,
      capturedText: input.capturedText ?? null,
      money: input.money ?? null,
      purchasedOn: input.purchasedOn ?? null,
      renewsOn: input.renewsOn ?? null,
      scope: visibility.scope,
      householdId: visibility.householdId,
      sourceRecordId: input.sourceRecordId ?? null,
      reviewGroupId,
      createdByUserId: input.ownerUserId,
      lastActorUserId: input.ownerUserId,
    },
    fileBytes: input.file?.bytes,
  });

  await writeAssetChildShares(store, {
    ...visibility,
    ownerUserId: input.ownerUserId,
    recordKind: "asset_evidence",
    recordId: evidence.id,
  });

  await recordAudit(store, anchor, {
    kind: "evidence_added",
    actorUserId: input.ownerUserId,
    source: input.source ?? "user",
    detail: {
      evidenceId: evidence.id,
      kind: evidence.kind,
      label: evidence.label,
      scope: evidence.scope,
      hasFile: evidence.fileName !== null,
      ...(reviewGroupId ? { reviewGroupId } : {}),
    },
  });

  return evidence;
}

/**
 * Captures Asset Evidence to a destination that doesn't exist yet (#201): opens
 * a review-gated Suggested Asset proposal — never a silently-created active
 * asset — and attaches the capture to its Asset Review Group through
 * {@link addAssetEvidence}, so the shared-path invariants (file vetting, scope
 * ceiling, audit provenance) never fork. The upload is vetted *before* the
 * proposal persists, so a rejected file leaves nothing behind. The proposal
 * argues private visibility; acceptance chooses the final audience. Explicit
 * user intent (they named the thing) is the provenance — the group records a
 * null source, paralleling the ungrounded action-hint promotion path (#199).
 */
export async function addAssetEvidenceToNewAsset(
  store: AssetReviewLifecycleStore,
  input: AddAssetEvidenceToNewAssetInput,
): Promise<{ evidence: AssetEvidence; group: AssetReviewGroupResult }> {
  if (input.file) {
    assertAssetEvidenceFileAccepted(input.file);
    assertAssetEvidenceFileSignature(input.file);
  }

  const { group } = await openSuggestedAssetProposal(store, {
    ownerUserId: input.ownerUserId,
    actorUserId: input.ownerUserId,
    name: input.asset.name,
    kind: input.asset.kind,
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    auditSource: input.source ?? "user",
    auditDetail: { via: "evidence_capture" },
  });

  const { asset: _asset, ...evidenceFields } = input;
  const evidence = await addAssetEvidence(store, {
    ...evidenceFields,
    reviewGroupId: group.id,
  });

  return { evidence, group: await buildGroupResult(store, group) };
}

/** The destinations a capture surface may offer (#201). */
export type AssetEvidenceCaptureTargets = {
  /** The owner's own active assets — capture is an owner act. */
  assets: Asset[];
  /** Still-open review groups, each with its anchor proposal, newest first. */
  reviews: { groupId: string; asset: Asset }[];
};

/**
 * The destinations a chat capture can choose from (#201): the owner's own
 * *active* assets — capture is an owner act, so a co-member's asset the caller
 * can merely see is not offered (the same gate the Asset Profile applies) —
 * plus the owner's still-open Asset Review Groups with their anchor proposals.
 * The owner/active/open rule lives here, in one owner-scoped entry point, so
 * no surface re-derives it.
 */
export async function listAssetEvidenceCaptureTargets(
  store: AssetReviewLifecycleStore,
  input: { ownerUserId: string },
): Promise<AssetEvidenceCaptureTargets> {
  const [visible, groups] = await Promise.all([
    store.listVisibleAssetsForCaller({ callerUserId: input.ownerUserId, statuses: ["active"] }),
    store.listPendingAssetReviewGroupsForOwner({ ownerUserId: input.ownerUserId }),
  ]);

  const reviews: AssetEvidenceCaptureTargets["reviews"] = [];
  for (const group of groups) {
    const anchor = await loadAnchor(store, input.ownerUserId, group.assetId);
    // A pending group's anchor always exists; archived anchors are filtered
    // defensively — the capture write would refuse them anyway.
    if (anchor && anchor.status !== "archived" && anchor.status !== "dismissed") {
      reviews.push({ groupId: group.id, asset: anchor });
    }
  }

  return {
    assets: visible.filter((asset) => asset.ownerUserId === input.ownerUserId),
    reviews,
  };
}

/**
 * Removes one piece of Asset Evidence — the row and its stored bytes together.
 * Owner-only, fail-closed: a co-member who can *see* household evidence can
 * never delete it, and a missing row and a hidden one deny identically.
 */
export async function removeAssetEvidence(
  store: AssetReviewLifecycleStore,
  input: RemoveAssetEvidenceInput,
): Promise<void> {
  const evidence = await store.getAssetEvidence({
    ownerUserId: input.actorUserId,
    evidenceId: input.evidenceId,
  });
  if (!evidence) {
    throw new Error("Asset evidence not found.");
  }

  await store.deleteAssetEvidence({
    ownerUserId: evidence.ownerUserId,
    evidenceId: evidence.id,
  });

  const anchor = await loadAnchor(store, evidence.ownerUserId, evidence.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "evidence_removed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { evidenceId: evidence.id, kind: evidence.kind, label: evidence.label },
    });
  }
}

/**
 * The gated file read behind every evidence download/preview: bytes are returned
 * only when the caller may see the evidence record itself — the owner always,
 * a household member exactly when the record's own scope reaches them. A hidden
 * file and a missing one are indistinguishable (`null`), fail-closed.
 */
export async function getAssetEvidenceFileForCaller(
  store: AssetReviewLifecycleStore,
  input: { callerUserId: string; evidenceId: string },
): Promise<AssetEvidenceFilePayload | null> {
  const evidence =
    (await store.getAssetEvidence({
      ownerUserId: input.callerUserId,
      evidenceId: input.evidenceId,
    })) ?? (await store.getVisibleAssetEvidence(input));
  if (!evidence || evidence.fileName === null || evidence.mimeType === null) {
    return null;
  }

  const bytes = await store.getAssetEvidenceFileBytes({ evidenceId: evidence.id });
  if (!bytes) {
    return null;
  }
  return {
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes ?? bytes.byteLength,
    bytes,
  };
}
