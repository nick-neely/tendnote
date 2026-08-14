import {
  addAssetEvidence,
  dismissAssetReviewGroup,
  findAssetReviewGroupBySource,
  getAssetReviewGroup,
  suggestAsset,
} from "./assets";
import { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";
import { createConversationalCapture } from "./capture/conversational-capture";
import { createCaptureVisibilityResolver } from "./capture/conversational-capture/visibility";
import {
  archiveSelfContextFact,
  createSelfContextFact,
  getSelfContextFactForCapture,
  updateSelfContextFact,
} from "./context-facts";
import { archiveFollowup, createFollowup, editFollowup, getFollowup } from "./followups";
import {
  archiveGeneralAction,
  createGeneralAction,
  editGeneralAction,
  getGeneralAction,
} from "./general-actions";
import {
  listActiveHouseholdMembershipsForUser,
  listShareableHouseholdMembersForUser,
} from "./households";
import {
  archiveMemory,
  captureExplicitMemoryFromSource,
  captureSuggestedMemoryFromSource,
  getMemory,
} from "./memories";
import {
  assertCaptureOnlyPersonRemovable,
  deleteCaptureOnlyPerson,
  getPerson,
  searchPeople,
  updatePerson,
} from "./people";
import { archiveSavedItem, editSavedItem } from "./saved-items";
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";
import {
  linkSourceRecordToExistingPerson,
  resolveOrCreateAndLinkPersonToSourceRecord,
  unlinkSourceRecordFromPerson,
} from "./source-records";

export type {
  CaptureOutcomeUndoOutcome,
  CaptureOutcomeUndoResult,
  ConversationalCaptureInput,
} from "./capture/conversational-capture";
export { createConversationalCapture } from "./capture/conversational-capture";

const briefScheduleStore = createDrizzleBriefScheduleStore();
const resolveVisibility = createCaptureVisibilityResolver({
  listMemberships: listActiveHouseholdMembershipsForUser,
  listMembers: listShareableHouseholdMembersForUser,
});
const defaultConversationalCapture = createConversationalCapture(
  createDrizzleSavedItemLifecycleStore(),
  {
    resolveOrCreateAndLinkPerson: resolveOrCreateAndLinkPersonToSourceRecord,
    linkSourceRecordToPerson: linkSourceRecordToExistingPerson,
    createApprovedMemory: async (input) => {
      const outcome = await captureExplicitMemoryFromSource(input);
      return { result: outcome.result.memory, affectedScopes: outcome.affectedScopes };
    },
    createSuggestedMemory: async (input) => {
      const outcome = await captureSuggestedMemoryFromSource(input);
      return { result: outcome.result.memory, affectedScopes: outcome.affectedScopes };
    },
    suggestAsset,
    addAssetEvidence,
    getPerson,
    updatePerson,
    assertCapturedPersonRemovable: assertCaptureOnlyPersonRemovable,
    deleteCapturedPerson: deleteCaptureOnlyPerson,
    async unlinkCapturedPerson(input) {
      return (await unlinkSourceRecordFromPerson(input)).person;
    },
    getMemory,
    archiveMemory,
    getAssetReview: getAssetReviewGroup,
    findAssetReviewBySource: findAssetReviewGroupBySource,
    dismissAssetReview: dismissAssetReviewGroup,
    createGeneralAction,
    createFollowup,
    editGeneralAction,
    editFollowup,
    archiveGeneralAction,
    archiveFollowup,
    archiveSavedItem,
    editSavedItem,
    createSelfContextFact: async (input) =>
      createSelfContextFact(
        {
          callerUserId: input.ownerUserId,
          category: input.category,
          content: input.content,
          sensitivity: input.sensitivity,
          provenance: {
            channel: "capture",
            origin: "direct",
            sourceRecordId: input.sourceRecordId,
          },
        },
        async () => input.ownerUserId,
      ),
    getSelfContextFact: async (input) =>
      getSelfContextFactForCapture(
        { callerUserId: input.ownerUserId, contextFactId: input.contextFactId },
        async () => input.ownerUserId,
      ),
    updateSelfContextFact: async (input) =>
      updateSelfContextFact(
        {
          callerUserId: input.actorUserId,
          contextFactId: input.contextFactId,
          category: input.category,
          content: input.content,
          sensitivity: input.sensitivity,
          ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
        },
        async () => input.actorUserId,
      ),
    archiveSelfContextFact: async (input) =>
      archiveSelfContextFact(
        {
          callerUserId: input.actorUserId,
          contextFactId: input.contextFactId,
          ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
        },
        async () => input.actorUserId,
      ),
    getGeneralAction: ({ ownerUserId, generalActionId }) =>
      getGeneralAction({ actorUserId: ownerUserId, generalActionId }).catch(() => null),
    getFollowup: ({ ownerUserId, followupId }) =>
      getFollowup({ actorUserId: ownerUserId, followupId }).catch(() => null),
    searchPeople,
    resolveVisibility,
    async ownerTimeZone(ownerUserId) {
      const schedule = await briefScheduleStore.getBriefScheduleForOwner({
        ownerUserId,
        cadence: "daily",
      });
      return schedule?.timezone ?? process.env.TENDNOTE_OWNER_TIMEZONE ?? "UTC";
    },
  },
);

export function captureExplicitOutcome(
  input: Parameters<typeof defaultConversationalCapture.capture>[0],
) {
  return defaultConversationalCapture.capture(input);
}

export function changeExplicitCaptureOutcome(
  input: Parameters<typeof defaultConversationalCapture.changeOutcome>[0],
) {
  return defaultConversationalCapture.changeOutcome(input);
}

export function undoExplicitCaptureOutcome(
  input: Parameters<typeof defaultConversationalCapture.undoOutcome>[0],
) {
  return defaultConversationalCapture.undoOutcome(input);
}
