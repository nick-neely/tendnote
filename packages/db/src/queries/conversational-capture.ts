import { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";
import { createConversationalCapture } from "./capture/conversational-capture";
import { archiveFollowup, createFollowup, editFollowup, getFollowup } from "./followups";
import {
  archiveGeneralAction,
  createGeneralAction,
  editGeneralAction,
  getGeneralAction,
} from "./general-actions";
import { searchPeople } from "./people";
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";

export type { ConversationalCaptureInput } from "./capture/conversational-capture";
export { createConversationalCapture } from "./capture/conversational-capture";

const briefScheduleStore = createDrizzleBriefScheduleStore();
const defaultConversationalCapture = createConversationalCapture(
  createDrizzleSavedItemLifecycleStore(),
  {
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
