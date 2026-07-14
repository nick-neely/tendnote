import type {
  ListLinkedActionsInput,
  ListLinkedAssetsInput,
  PromoteGeneralActionAssetHintInput,
} from "./assets/action-link-types";
import { createAssetActionLinks } from "./assets/action-links";
import type {
  ListPendingAssetActionProposalsInput,
  ProposeAssetMemoryActionsInput,
} from "./assets/action-proposal-types";
import { createAssetActionProposals } from "./assets/action-proposals";
import { createDrizzleAssetLinkStore } from "./assets/drizzle-link-store";
import {
  createDrizzleAssetLifecycleStore,
  createDrizzleAssetReviewLifecycleStore,
} from "./assets/drizzle-store";
import type {
  AddAssetEvidenceInput,
  AddAssetEvidenceToNewAssetInput,
  RemoveAssetEvidenceInput,
} from "./assets/evidence-types";
import { createAssetHistory } from "./assets/history";
import { createAssetLifecycle } from "./assets/lifecycle";
import type {
  AddAssetLinkInput,
  AddAssetPersonLinkInput,
  AssetLinkActionInput,
  ListAssetContextInput,
  SuggestAssetLinkInput,
} from "./assets/link-types";
import { createAssetContextLinks } from "./assets/links";
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
import { enqueueAndTriggerSemanticEmbeddingJob } from "./semantic-retrieval";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";

export type * from "./assets/action-link-types";
export { createAssetActionLinks } from "./assets/action-links";
export type * from "./assets/action-proposal-types";
export { createAssetActionProposals } from "./assets/action-proposals";
export { createDrizzleGeneralActionAssetLinkStore } from "./assets/drizzle-action-link-store";
export { createDrizzleAssetEvidenceStore } from "./assets/drizzle-evidence-store";
export { createDrizzleAssetLinkStore } from "./assets/drizzle-link-store";
export { createDrizzleAssetReviewStore } from "./assets/drizzle-review-store";
export {
  createDrizzleAssetLifecycleStore,
  createDrizzleAssetReviewLifecycleStore,
  createDrizzleAssetStore,
} from "./assets/drizzle-store";
export type * from "./assets/evidence-types";
export { createAssetHistory } from "./assets/history";
export { createInMemoryAssetActionLinkStore } from "./assets/in-memory-action-link-store";
export { createInMemoryAssetEvidenceStore } from "./assets/in-memory-evidence-store";
export { createInMemoryAssetLinkStore } from "./assets/in-memory-link-store";
export {
  createInMemoryAssetReviewLifecycleStore,
  createInMemoryAssetReviewStore,
  createInMemoryGeneralActionAssetLinkStore,
} from "./assets/in-memory-review-store";
export { createInMemoryAssetStore } from "./assets/in-memory-store";
export { createAssetLifecycle } from "./assets/lifecycle";
export type * from "./assets/link-types";
export { createAssetContextLinks } from "./assets/links";
export { createAssetReview } from "./assets/review";
export type * from "./assets/review-types";
export type * from "./assets/types";

const defaultAssetLifecycle = createAssetLifecycle(createDrizzleAssetLifecycleStore());
const defaultAssetReview = createAssetReview(createDrizzleAssetReviewLifecycleStore());
const defaultAssetActionLinks = createAssetActionLinks({
  ...createDrizzleAssetReviewLifecycleStore(),
  ...createDrizzleGeneralActionStore(),
});
// The proposal seam also *writes* General Actions, so it composes the source-record
// store for the person/grounding reads the shared hydration path needs, and takes the
// same embed-on-write scheduler the General Action lifecycle and review seams take —
// an asset-derived proposal is embedded when suggested, exactly like any other (#203).
const defaultAssetActionProposals = createAssetActionProposals(
  {
    ...createDrizzleAssetReviewLifecycleStore(),
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleGeneralActionStore(),
  },
  { scheduleGeneralActionEmbedding: enqueueAndTriggerSemanticEmbeddingJob },
);
const defaultAssetContextLinks = createAssetContextLinks({
  ...createDrizzleAssetReviewLifecycleStore(),
  ...createDrizzleSourceRecordStore(),
  ...createDrizzleAssetLinkStore(),
});
const defaultAssetHistory = createAssetHistory({
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

/**
 * Proposes Suggested General Actions from an Asset's reviewed, timed memories (#203).
 * Every proposal lands in review — this can never create an active action.
 */
export async function proposeAssetMemoryActions(input: ProposeAssetMemoryActionsInput) {
  return defaultAssetActionProposals.proposeAssetMemoryActions(input);
}

/** The owner's still-suggested asset-derived actions, for the Asset Profile (#203). */
export async function listPendingAssetActionProposals(input: ListPendingAssetActionProposalsInput) {
  return defaultAssetActionProposals.listPendingAssetActionProposals(input);
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

// --- Related Asset Links, Asset Person Links, and Asset History (#202) ---

export async function addAssetLink(input: AddAssetLinkInput) {
  return defaultAssetContextLinks.addAssetLink(input);
}

export async function suggestAssetLink(input: SuggestAssetLinkInput) {
  return defaultAssetContextLinks.suggestAssetLink(input);
}

export async function acceptSuggestedAssetLink(input: AssetLinkActionInput) {
  return defaultAssetContextLinks.acceptSuggestedAssetLink(input);
}

export async function dismissSuggestedAssetLink(input: AssetLinkActionInput) {
  return defaultAssetContextLinks.dismissSuggestedAssetLink(input);
}

export async function removeAssetLink(input: AssetLinkActionInput) {
  return defaultAssetContextLinks.removeAssetLink(input);
}

export async function listRelatedAssetLinks(input: ListAssetContextInput) {
  return defaultAssetContextLinks.listRelatedAssetLinks(input);
}

export async function addAssetPersonLink(input: AddAssetPersonLinkInput) {
  return defaultAssetContextLinks.addAssetPersonLink(input);
}

export async function removeAssetPersonLink(input: AssetLinkActionInput) {
  return defaultAssetContextLinks.removeAssetPersonLink(input);
}

export async function listAssetPersonLinks(input: ListAssetContextInput) {
  return defaultAssetContextLinks.listAssetPersonLinks(input);
}

export async function listAssetHistory(input: ListAssetContextInput & { limit?: number }) {
  return defaultAssetHistory.listAssetHistory(input);
}
