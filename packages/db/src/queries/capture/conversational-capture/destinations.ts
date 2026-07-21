import {
  type ConversationalCaptureRoute,
  conversationalCaptureConfirmationSchema,
} from "@tendnote/domain";
import { hydrateSavedItem } from "../../saved-items/context";
import { createGroundedSavedItem } from "../../saved-items/creation";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import {
  actionConfirmation,
  fallbackKind,
  followupConfirmation,
  savedItemConfirmation,
} from "./policy";
import type { ConversationalCaptureDeps, ResolvedCapturePerson } from "./types";

export type CaptureDestinationIds = {
  savedItemId: string;
  savedItemEventId: string;
  generalActionId: string;
  followupId: string;
};

type ResolvedRoute = Exclude<ConversationalCaptureRoute, { destination: "clarification" }>;

export async function createCaptureDestination(input: {
  store: SavedItemLifecycleStore;
  deps: ConversationalCaptureDeps;
  route: ResolvedRoute;
  resolvedPerson?: ResolvedCapturePerson | null;
  ownerUserId: string;
  originalText: string;
  sourceRecordId: string;
  ids: CaptureDestinationIds;
}) {
  if (input.route.destination === "action") {
    return createActionDestination({ ...input, route: input.route });
  }
  if (input.route.destination === "followup") {
    return createFollowupDestination({ ...input, route: input.route });
  }
  return createSavedItemDestination({ ...input, route: input.route });
}

async function createActionDestination(
  input: Parameters<typeof createCaptureDestination>[0] & {
    route: Extract<ResolvedRoute, { destination: "action" }>;
  },
) {
  const { createGeneralAction } = input.deps;
  if (!createGeneralAction) throw new Error("Action capture is unavailable.");
  const getExisting = () =>
    input.deps.getGeneralAction?.({
      ownerUserId: input.ownerUserId,
      generalActionId: input.ids.generalActionId,
    });
  let generalAction = await getExisting();
  if (!generalAction) {
    try {
      generalAction = await createGeneralAction({
        id: input.ids.generalActionId,
        ownerUserId: input.ownerUserId,
        title: input.route.title,
        dueAt: input.route.dueAt,
        recurrence: input.route.recurrence,
        sourceRecordId: input.sourceRecordId,
        scope: "private",
      });
    } catch (error) {
      const racedAction = await getExisting();
      if (!racedAction) throw error;
      generalAction = racedAction;
    }
  }
  const confirmation = conversationalCaptureConfirmationSchema.parse(
    actionConfirmation({
      sourceRecordId: input.sourceRecordId,
      generalActionId: generalAction.id,
      route: input.route,
    }),
  );
  return { generalAction, confirmation, id: generalAction.id };
}

async function createFollowupDestination(
  input: Parameters<typeof createCaptureDestination>[0] & {
    route: Extract<ResolvedRoute, { destination: "followup" }>;
  },
) {
  const { createFollowup } = input.deps;
  if (!createFollowup || !input.resolvedPerson) {
    throw new Error("Follow-Up capture is unavailable.");
  }
  const getExisting = () =>
    input.deps.getFollowup?.({
      ownerUserId: input.ownerUserId,
      followupId: input.ids.followupId,
    });
  let followup = await getExisting();
  if (!followup) {
    try {
      followup = await createFollowup({
        id: input.ids.followupId,
        ownerUserId: input.ownerUserId,
        personId: input.resolvedPerson.id,
        reason: input.route.reason,
        dueAt: input.route.dueAt,
        sourceRecordId: input.sourceRecordId,
        scope: "private",
      });
    } catch (error) {
      const racedFollowup = await getExisting();
      if (!racedFollowup) throw error;
      followup = racedFollowup;
    }
  }
  const confirmation = conversationalCaptureConfirmationSchema.parse(
    followupConfirmation({
      sourceRecordId: input.sourceRecordId,
      followupId: followup.id,
      person: input.resolvedPerson,
      route: input.route,
    }),
  );
  return { followup, confirmation, id: followup.id };
}

async function createSavedItemDestination(
  input: Parameters<typeof createCaptureDestination>[0] & {
    route: Extract<ResolvedRoute, { destination: "saved_item" }>;
  },
) {
  const existing = await input.store.getSavedItem({
    ownerUserId: input.ownerUserId,
    savedItemId: input.ids.savedItemId,
  });
  if (existing && existing.sourceRecordId !== input.sourceRecordId) {
    throw new Error("This capture interaction is linked to different source evidence.");
  }
  const kind = fallbackKind(input.originalText);
  const savedItem = existing
    ? await hydrateSavedItem(input.store, existing)
    : await createGroundedSavedItem(input.store, {
        id: input.ids.savedItemId,
        createdEventId: input.ids.savedItemEventId,
        ownerUserId: input.ownerUserId,
        kind,
        title: input.originalText.slice(0, 240),
        content: kind === "link" ? null : input.originalText,
        url: kind === "link" ? input.originalText : null,
        originalText: input.originalText,
        sourceRecordId: input.sourceRecordId,
        scope: "private",
      });
  const confirmation = conversationalCaptureConfirmationSchema.parse(
    savedItemConfirmation({
      sourceRecordId: input.sourceRecordId,
      savedItemId: savedItem.id,
      kind,
    }),
  );
  return { savedItem, confirmation, id: savedItem.id };
}
