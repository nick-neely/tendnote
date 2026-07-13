import {
  type Asset,
  type AssetChildScope,
  type AssetEvidence,
  AssetValidationError,
  assertAssetEvidenceFileAccepted,
  assertAssetEvidenceFileSignature,
  defaultChildScopeForAsset,
  requireChildScopeWithinAsset,
} from "@tendnote/domain";
import type {
  AddAssetEvidenceInput,
  AssetEvidenceFilePayload,
  RemoveAssetEvidenceInput,
} from "./evidence-types";
import { recordAudit } from "./lifecycle";
import { loadAnchor, requireActiveAnchor, requireGroup, SET_ASIDE } from "./review-shared";
import type { AssetReviewLifecycleStore } from "./review-types";

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
    throw new AssetValidationError("Attach evidence to an asset or a review item — exactly one.");
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
    throw new AssetValidationError("This asset is archived — restore it before adding evidence.");
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

  const scope: AssetChildScope = input.scope ?? defaultChildScopeForAsset(anchor.scope);
  requireChildScopeWithinAsset({ childScope: scope, assetScope: anchor.scope });

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
      scope,
      householdId: scope === "household" ? anchor.householdId : null,
      sourceRecordId: input.sourceRecordId ?? null,
      reviewGroupId,
      createdByUserId: input.ownerUserId,
      lastActorUserId: input.ownerUserId,
    },
    fileBytes: input.file?.bytes,
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
