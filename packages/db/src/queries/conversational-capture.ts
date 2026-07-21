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
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";
import {
  linkSourceRecordToExistingPerson,
  resolveOrCreateAndLinkPersonToSourceRecord,
  unlinkSourceRecordFromPerson,
} from "./source-records";

export type { ConversationalCaptureInput } from "./capture/conversational-capture";
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
    createApprovedMemory: async (input) => (await captureExplicitMemoryFromSource(input)).memory,
    createSuggestedMemory: async (input) => (await captureSuggestedMemoryFromSource(input)).memory,
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
