import type {
  ListLinkedActionsInput,
  ListLinkedAssetsInput,
  PromoteGeneralActionAssetHintInput,
} from "./assets/action-link-types";
import { createAssetActionLinks } from "./assets/action-links";
import {
  createDrizzleAssetLifecycleStore,
  createDrizzleAssetReviewLifecycleStore,
} from "./assets/drizzle-store";
import type {
  AddAssetEvidenceInput,
  AddAssetEvidenceToNewAssetInput,
  RemoveAssetEvidenceInput,
} from "./assets/evidence-types";
import { createAssetLifecycle } from "./assets/lifecycle";
import { createAssetReview } from "./assets/review";
import type {
  AcceptSuggestedAssetInput,
  AcceptSuggestedAssetMemoryInput,
  AssetMemoryActionInput,
  AssetReviewGroupActionInput,
  CreateActiveAssetMemoryInput,
  EditSuggestedAssetInput,
  EditSuggestedAssetMemoryInput,
  LinkAssetReviewGroupInput,
  ListAssetReviewGroupsInput,
  SuggestAssetInput,
  SuggestAssetMemoriesInput,
  SuggestedAssetActionInput,
} from "./assets/review-types";
import type {
  AssetActionInput,
  CreateActiveAssetInput,
  EditAssetInput,
  ListAssetAuditInput,
  ListAssetsInput,
} from "./assets/types";
import { createDrizzleGeneralActionStore } from "./general-actions/drizzle-store";

export type * from "./assets/action-link-types";
export { createAssetActionLinks } from "./assets/action-links";
export { createDrizzleGeneralActionAssetLinkStore } from "./assets/drizzle-action-link-store";
export { createDrizzleAssetEvidenceStore } from "./assets/drizzle-evidence-store";
export { createDrizzleAssetReviewStore } from "./assets/drizzle-review-store";
export {
  createDrizzleAssetLifecycleStore,
  createDrizzleAssetReviewLifecycleStore,
  createDrizzleAssetStore,
} from "./assets/drizzle-store";
export type * from "./assets/evidence-types";
export { createInMemoryAssetActionLinkStore } from "./assets/in-memory-action-link-store";
export { createInMemoryAssetEvidenceStore } from "./assets/in-memory-evidence-store";
export {
  createInMemoryAssetReviewLifecycleStore,
  createInMemoryAssetReviewStore,
  createInMemoryGeneralActionAssetLinkStore,
} from "./assets/in-memory-review-store";
export { createInMemoryAssetStore } from "./assets/in-memory-store";
export { createAssetLifecycle } from "./assets/lifecycle";
export { createAssetReview } from "./assets/review";
export type * from "./assets/review-types";
export type * from "./assets/types";

const defaultAssetLifecycle = createAssetLifecycle(createDrizzleAssetLifecycleStore());
const defaultAssetReview = createAssetReview(createDrizzleAssetReviewLifecycleStore());
const defaultAssetActionLinks = createAssetActionLinks({
  ...createDrizzleAssetReviewLifecycleStore(),
  ...createDrizzleGeneralActionStore(),
});

export async function createAsset(input: CreateActiveAssetInput) {
  return defaultAssetLifecycle.createAsset(input);
}

export async function editAsset(input: EditAssetInput) {
  return defaultAssetLifecycle.editAsset(input);
}

export async function archiveAsset(input: AssetActionInput) {
  return defaultAssetLifecycle.archiveAsset(input);
}

export async function restoreAsset(input: AssetActionInput) {
  return defaultAssetLifecycle.restoreAsset(input);
}

export async function getAsset(input: { callerUserId: string; assetId: string }) {
  return defaultAssetLifecycle.getAsset(input);
}

export async function listAssets(input: ListAssetsInput) {
  return defaultAssetLifecycle.listAssets(input);
}

export async function listAssetAudit(input: ListAssetAuditInput) {
  return defaultAssetLifecycle.listAssetAudit(input);
}

// --- Review-gated Asset Memory and duplicate review (#198) ---

export async function suggestAsset(input: SuggestAssetInput) {
  return defaultAssetReview.suggestAsset(input);
}

export async function suggestAssetMemories(input: SuggestAssetMemoriesInput) {
  return defaultAssetReview.suggestAssetMemories(input);
}

export async function createActiveAssetMemory(input: CreateActiveAssetMemoryInput) {
  return defaultAssetReview.createActiveAssetMemory(input);
}

export async function listAssetReviewGroups(input: ListAssetReviewGroupsInput) {
  return defaultAssetReview.listAssetReviewGroups(input);
}

export async function getAssetReviewGroup(input: { actorUserId: string; groupId: string }) {
  return defaultAssetReview.getAssetReviewGroup(input);
}

export async function listAssetMemories(input: { callerUserId: string; assetId: string }) {
  return defaultAssetReview.listAssetMemories(input);
}

export async function acceptSuggestedAsset(input: AcceptSuggestedAssetInput) {
  return defaultAssetReview.acceptSuggestedAsset(input);
}

export async function editSuggestedAsset(input: EditSuggestedAssetInput) {
  return defaultAssetReview.editSuggestedAsset(input);
}

export async function dismissSuggestedAsset(input: SuggestedAssetActionInput) {
  return defaultAssetReview.dismissSuggestedAsset(input);
}

export async function acceptSuggestedAssetMemory(input: AcceptSuggestedAssetMemoryInput) {
  return defaultAssetReview.acceptSuggestedAssetMemory(input);
}

export async function editSuggestedAssetMemory(input: EditSuggestedAssetMemoryInput) {
  return defaultAssetReview.editSuggestedAssetMemory(input);
}

export async function dismissSuggestedAssetMemory(input: AssetMemoryActionInput) {
  return defaultAssetReview.dismissSuggestedAssetMemory(input);
}

export async function acceptAssetReviewGroup(input: AssetReviewGroupActionInput) {
  return defaultAssetReview.acceptAssetReviewGroup(input);
}

export async function dismissAssetReviewGroup(input: AssetReviewGroupActionInput) {
  return defaultAssetReview.dismissAssetReviewGroup(input);
}

export async function linkAssetReviewGroup(input: LinkAssetReviewGroupInput) {
  return defaultAssetReview.linkAssetReviewGroup(input);
}

// --- General Action asset-hint promotion and action↔asset links (#199) ---

export async function promoteGeneralActionAssetHint(input: PromoteGeneralActionAssetHintInput) {
  return defaultAssetActionLinks.promoteGeneralActionAssetHint(input);
}

export async function listLinkedAssetsForGeneralActions(input: ListLinkedAssetsInput) {
  return defaultAssetActionLinks.listLinkedAssetsForGeneralActions(input);
}

export async function listLinkedGeneralActionsForAsset(input: ListLinkedActionsInput) {
  return defaultAssetActionLinks.listLinkedGeneralActionsForAsset(input);
}

export async function getPromotedFromGeneralAction(input: {
  ownerUserId: string;
  assetId: string;
}) {
  return defaultAssetActionLinks.getPromotedFromGeneralAction(input);
}

// --- Shared Asset Evidence Capture (#200) ---

export async function addAssetEvidence(input: AddAssetEvidenceInput) {
  return defaultAssetReview.addAssetEvidence(input);
}

export async function addAssetEvidenceToNewAsset(input: AddAssetEvidenceToNewAssetInput) {
  return defaultAssetReview.addAssetEvidenceToNewAsset(input);
}

export async function listAssetEvidenceCaptureTargets(input: { ownerUserId: string }) {
  return defaultAssetReview.listAssetEvidenceCaptureTargets(input);
}

export async function removeAssetEvidence(input: RemoveAssetEvidenceInput) {
  return defaultAssetReview.removeAssetEvidence(input);
}

export async function listAssetEvidence(input: { callerUserId: string; assetId: string }) {
  return defaultAssetReview.listAssetEvidence(input);
}

export async function getAssetEvidenceFile(input: { callerUserId: string; evidenceId: string }) {
  return defaultAssetReview.getAssetEvidenceFile(input);
}
