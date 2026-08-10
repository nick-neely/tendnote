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
import { createAssetBrowser } from "./assets/browse";
import { createDrizzleAssetBrowseStore } from "./assets/drizzle-browse-store";
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
import { createAffectedAssetLifecycle } from "./assets/mutation-lifecycle";
import {
  assetAndGeneralActionMutationOutcome,
  assetIdsMutationOutcome,
  reviewMutationOutcome,
} from "./assets/mutation-outcomes";
import { createAssetReview } from "./assets/review";
import type {
  AcceptSuggestedAssetInput,
  AcceptSuggestedAssetMemoryInput,
  AssetMemoryActionInput,
  AssetReviewGroupActionInput,
  CreateActiveAssetMemoryInput,
  EditAssetMemoryInput,
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
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { enqueueAndTriggerSemanticEmbeddingJob } from "./semantic-retrieval";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";

export type * from "./assets/action-link-types";
export { createAssetActionLinks } from "./assets/action-links";
export type * from "./assets/action-proposal-types";
export { createAssetActionProposals } from "./assets/action-proposals";
export { createAssetBrowser } from "./assets/browse";
export type * from "./assets/browse-types";
export { createDrizzleGeneralActionAssetLinkStore } from "./assets/drizzle-action-link-store";
export { createDrizzleAssetBrowseStore } from "./assets/drizzle-browse-store";
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

// Assets and their reviewed memories participate in semantic retrieval, so every
// durable write enqueues (and, outside production, immediately runs) an embedding job
// on the shared pipeline (#204) — the same trigger General Actions use.
const scheduleAssetEmbedding = enqueueAndTriggerSemanticEmbeddingJob;

const defaultAssetLifecycle = createAffectedAssetLifecycle(
  createAssetLifecycle(createDrizzleAssetLifecycleStore(), {
    scheduleAssetEmbedding,
  }),
);
// The browse adapter plus the two reads a Household Authorization Proof is built
// from, so a ledger page is proved and not merely pre-filtered (ADR 0219).
const defaultAssetBrowser = createAssetBrowser({
  ...createDrizzleAssetBrowseStore(),
  ...createDrizzleHouseholdStore(),
});
const defaultAssetReview = createAssetReview(createDrizzleAssetReviewLifecycleStore(), {
  scheduleAssetEmbedding,
});
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
  ...createDrizzleSourceRecordStore(),
  ...createDrizzleAssetLinkStore(),
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

export async function hardDeleteAsset(input: AssetActionInput) {
  return defaultAssetLifecycle.hardDeleteAsset(input);
}

export async function getAsset(input: { callerUserId: string; assetId: string }) {
  return defaultAssetLifecycle.getAsset(input);
}

export async function listAssets(input: ListAssetsInput) {
  return defaultAssetLifecycle.listAssets(input);
}

export async function browseAssets(input: import("./assets/browse-types").BrowseAssetsInput) {
  const page = await defaultAssetBrowser.browseAssets(input);
  const hydrated = await Promise.all(
    page.items.map(async (item) => {
      const asset = await defaultAssetLifecycle.getAsset({
        callerUserId: input.callerUserId,
        assetId: item.asset.id,
      });
      // A row the page proved and the hydrating read refuses lost a race with
      // something that ended the caller's standing. It is dropped rather than
      // thrown on: the ledger settling one row shorter is the correct outcome,
      // and an error page would announce that the record exists (ADR 0219).
      return asset ? { ...item, asset } : null;
    }),
  );
  return {
    ...page,
    items: hydrated.filter((item): item is NonNullable<typeof item> => item !== null),
  };
}

export async function listAssetAudit(input: ListAssetAuditInput) {
  return defaultAssetLifecycle.listAssetAudit(input);
}

// --- Review-gated Asset Memory and duplicate review (#198) ---

export async function suggestAsset(input: SuggestAssetInput) {
  return reviewMutationOutcome(defaultAssetReview.suggestAsset(input));
}

export async function suggestAssetMemories(input: SuggestAssetMemoriesInput) {
  return reviewMutationOutcome(defaultAssetReview.suggestAssetMemories(input));
}

export async function createActiveAssetMemory(input: CreateActiveAssetMemoryInput) {
  return assetIdsMutationOutcome(
    defaultAssetReview.createActiveAssetMemory(input),
    input.ownerUserId,
    (result) => [result.assetId],
  );
}

/**
 * Corrects a detail that is already true (#386) — distinct from the review edits
 * below, which correct a *proposal* before it becomes one. Authority is the
 * proof's: the owner of a member-owned detail, any active member of the
 * household's own.
 */
export async function editAssetMemory(input: EditAssetMemoryInput) {
  const memory = await defaultAssetReview.editAssetMemory(input);
  // Keyed on the record's owner rather than the actor: on a household detail the
  // two differ, and the owner-collection tag has to name the collection the row
  // actually lives in.
  return assetIdsMutationOutcome(Promise.resolve(memory), memory.ownerUserId, (result) => [
    result.assetId,
  ]);
}

/** Sets aside a detail that is no longer true. Nothing is deleted (#386). */
export async function setAsideAssetMemory(input: AssetMemoryActionInput) {
  const memory = await defaultAssetReview.setAsideAssetMemory(input);
  return assetIdsMutationOutcome(Promise.resolve(memory), memory.ownerUserId, (result) => [
    result.assetId,
  ]);
}

export async function listAssetReviewGroups(input: ListAssetReviewGroupsInput) {
  return defaultAssetReview.listAssetReviewGroups(input);
}

export async function getAssetReviewGroup(input: { actorUserId: string; groupId: string }) {
  return defaultAssetReview.getAssetReviewGroup(input);
}

export async function findAssetReviewGroupBySource(input: {
  ownerUserId: string;
  sourceRecordId: string;
  assetName: string;
}) {
  return defaultAssetReview.findAssetReviewGroupBySource(input);
}

export async function listAssetMemories(input: { callerUserId: string; assetId: string }) {
  return defaultAssetReview.listAssetMemories(input);
}

export async function acceptSuggestedAsset(input: AcceptSuggestedAssetInput) {
  return reviewMutationOutcome(defaultAssetReview.acceptSuggestedAsset(input));
}

export async function editSuggestedAsset(input: EditSuggestedAssetInput) {
  return reviewMutationOutcome(defaultAssetReview.editSuggestedAsset(input));
}

export async function dismissSuggestedAsset(input: SuggestedAssetActionInput) {
  return reviewMutationOutcome(defaultAssetReview.dismissSuggestedAsset(input));
}

export async function acceptSuggestedAssetMemory(input: AcceptSuggestedAssetMemoryInput) {
  return reviewMutationOutcome(defaultAssetReview.acceptSuggestedAssetMemory(input));
}

export async function editSuggestedAssetMemory(input: EditSuggestedAssetMemoryInput) {
  return reviewMutationOutcome(defaultAssetReview.editSuggestedAssetMemory(input));
}

export async function dismissSuggestedAssetMemory(input: AssetMemoryActionInput) {
  return reviewMutationOutcome(defaultAssetReview.dismissSuggestedAssetMemory(input));
}

export async function acceptAssetReviewGroup(input: AssetReviewGroupActionInput) {
  return reviewMutationOutcome(defaultAssetReview.acceptAssetReviewGroup(input));
}

export async function dismissAssetReviewGroup(input: AssetReviewGroupActionInput) {
  return reviewMutationOutcome(defaultAssetReview.dismissAssetReviewGroup(input));
}

export async function linkAssetReviewGroup(input: LinkAssetReviewGroupInput) {
  return reviewMutationOutcome(defaultAssetReview.linkAssetReviewGroup(input));
}

// --- General Action asset-hint promotion and action↔asset links (#199) ---

export async function promoteGeneralActionAssetHint(input: PromoteGeneralActionAssetHintInput) {
  return assetAndGeneralActionMutationOutcome(
    defaultAssetActionLinks.promoteGeneralActionAssetHint(input),
    {
      ownerUserId: input.actorUserId,
      asset: (result) => (result.outcome === "pending_review" ? result.group.asset : result.asset),
      generalActionIds: () => [input.generalActionId],
    },
  );
}

export async function listLinkedAssetsForGeneralActions(input: ListLinkedAssetsInput) {
  return defaultAssetActionLinks.listLinkedAssetsForGeneralActions(input);
}

/**
 * Proposes Suggested General Actions from an Asset's reviewed, timed memories (#203).
 * Every proposal lands in review — this can never create an active action.
 */
export async function proposeAssetMemoryActions(input: ProposeAssetMemoryActionsInput) {
  return assetAndGeneralActionMutationOutcome(
    defaultAssetActionProposals.proposeAssetMemoryActions(input),
    {
      ownerUserId: input.actorUserId,
      asset: (result) => result.asset,
      generalActionIds: (result) => result.proposed.map((proposal) => proposal.action.id),
    },
  );
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
  return assetIdsMutationOutcome(
    defaultAssetReview.addAssetEvidence(input),
    input.ownerUserId,
    (result) => [result.assetId],
  );
}

export async function addAssetEvidenceToNewAsset(input: AddAssetEvidenceToNewAssetInput) {
  return assetIdsMutationOutcome(
    defaultAssetReview.addAssetEvidenceToNewAsset(input),
    input.ownerUserId,
    (result) => [result.evidence.assetId, result.group.asset.id],
  );
}

export async function listAssetEvidenceCaptureTargets(input: { ownerUserId: string }) {
  return defaultAssetReview.listAssetEvidenceCaptureTargets(input);
}

export async function removeAssetEvidence(input: RemoveAssetEvidenceInput) {
  return assetIdsMutationOutcome(
    defaultAssetReview.removeAssetEvidence(input),
    input.actorUserId,
    (result) => [result.assetId],
  );
}

export async function listAssetEvidence(input: { callerUserId: string; assetId: string }) {
  return defaultAssetReview.listAssetEvidence(input);
}

export async function getAssetEvidenceFile(input: { callerUserId: string; evidenceId: string }) {
  return defaultAssetReview.getAssetEvidenceFile(input);
}

// --- Related Asset Links, Asset Person Links, and Asset History (#202) ---

export async function addAssetLink(input: AddAssetLinkInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.addAssetLink(input),
    input.actorUserId,
    (result) => [result.fromAssetId, result.toAssetId],
  );
}

export async function suggestAssetLink(input: SuggestAssetLinkInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.suggestAssetLink(input),
    input.ownerUserId,
    (result) => [result.fromAssetId, result.toAssetId],
  );
}

export async function acceptSuggestedAssetLink(input: AssetLinkActionInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.acceptSuggestedAssetLink(input),
    input.actorUserId,
    (result) => [result.fromAssetId, result.toAssetId],
  );
}

export async function dismissSuggestedAssetLink(input: AssetLinkActionInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.dismissSuggestedAssetLink(input),
    input.actorUserId,
    (result) => [result.fromAssetId, result.toAssetId],
  );
}

export async function removeAssetLink(input: AssetLinkActionInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.removeAssetLink(input),
    input.actorUserId,
    (result) => [result.fromAssetId, result.toAssetId],
  );
}

export async function listRelatedAssetLinks(input: ListAssetContextInput) {
  return defaultAssetContextLinks.listRelatedAssetLinks(input);
}

export async function addAssetPersonLink(input: AddAssetPersonLinkInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.addAssetPersonLink(input),
    input.actorUserId,
    (result) => [result.assetId],
  );
}

export async function removeAssetPersonLink(input: AssetLinkActionInput) {
  return assetIdsMutationOutcome(
    defaultAssetContextLinks.removeAssetPersonLink(input),
    input.actorUserId,
    (result) => [result.assetId],
  );
}

export async function listAssetPersonLinks(input: ListAssetContextInput) {
  return defaultAssetContextLinks.listAssetPersonLinks(input);
}

export async function listAssetHistory(input: ListAssetContextInput & { limit?: number }) {
  return defaultAssetHistory.listAssetHistory(input);
}
