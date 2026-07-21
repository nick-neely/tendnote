import type {
  ConversationalCaptureChangeTarget,
  ConversationalCaptureUndoTarget,
  FollowupStatus,
  GeneralActionStatus,
  SavedItemStatus,
} from "@tendnote/domain";
import { hydrateSavedItem } from "../../saved-items/context";
import { createSavedItemLifecycle } from "../../saved-items/lifecycle";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import type { ConversationalCaptureDeps } from "./types";

export type CaptureOutcomeKind = "saved_item" | "general_action" | "followup";
export type CaptureOutcomeReference = { kind: CaptureOutcomeKind; id: string };
type CaptureOutcomeStatus = SavedItemStatus | GeneralActionStatus | FollowupStatus;
type LoadedCaptureOutcome = {
  sourceRecordId: string;
  status: CaptureOutcomeStatus;
  from: "Saved Items" | "Actions" | "Routines" | "Follow-Ups";
  personId?: string;
};

type CaptureOutcomeLifecycleOperation = {
  load: (actorUserId: string, id: string) => Promise<LoadedCaptureOutcome>;
  archive: (actorUserId: string, id: string, status: CaptureOutcomeStatus) => Promise<unknown>;
  undo: (actorUserId: string, id: string) => Promise<unknown>;
};

export function changeTargetReference(
  target: ConversationalCaptureChangeTarget,
): CaptureOutcomeReference {
  if (target.kind === "edit_saved_item") return { kind: "saved_item", id: target.savedItemId };
  if (target.kind === "edit_general_action") {
    return { kind: "general_action", id: target.generalActionId };
  }
  return { kind: "followup", id: target.followupId };
}

export function undoTargetReference(
  target: ConversationalCaptureUndoTarget,
): CaptureOutcomeReference {
  if (target.kind === "archive_saved_item") return { kind: "saved_item", id: target.savedItemId };
  if (target.kind === "archive_general_action") {
    return { kind: "general_action", id: target.generalActionId };
  }
  return { kind: "followup", id: target.followupId };
}

export function createCaptureOutcomeLifecycleOperations(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps,
): Record<CaptureOutcomeKind, CaptureOutcomeLifecycleOperation> {
  const savedItemLifecycle = createSavedItemLifecycle(store);
  return {
    saved_item: {
      async load(actorUserId, savedItemId) {
        const current = await store.getSavedItem({ ownerUserId: actorUserId, savedItemId });
        if (!current) throw new Error("That Saved Item is no longer available.");
        return {
          sourceRecordId: current.sourceRecordId,
          status: current.status,
          from: "Saved Items",
        };
      },
      async archive(actorUserId, savedItemId, status) {
        if (status === "archived") {
          const current = await store.getSavedItem({ ownerUserId: actorUserId, savedItemId });
          if (!current) throw new Error("That Saved Item is no longer available.");
          return hydrateSavedItem(store, current);
        }
        return savedItemLifecycle.archiveSavedItem({ actorUserId, savedItemId });
      },
      async undo(actorUserId, savedItemId) {
        const current = await store.getSavedItem({ ownerUserId: actorUserId, savedItemId });
        if (!current) throw new Error("That Saved Item is no longer available.");
        if (current.status === "archived") return hydrateSavedItem(store, current);
        return savedItemLifecycle.archiveSavedItem({ actorUserId, savedItemId });
      },
    },
    general_action: {
      async load(actorUserId, generalActionId) {
        const current = await deps.getGeneralAction?.({
          ownerUserId: actorUserId,
          generalActionId,
        });
        if (!current) throw new Error("That Action is no longer available.");
        if (!current.sourceRecordId) {
          throw new Error("That captured outcome has no source evidence to preserve.");
        }
        return {
          sourceRecordId: current.sourceRecordId,
          status: current.status,
          from: current.recurrence ? "Routines" : "Actions",
        };
      },
      async archive(actorUserId, generalActionId, status) {
        if (status === "archived")
          return deps.getGeneralAction?.({ ownerUserId: actorUserId, generalActionId });
        if (!deps.archiveGeneralAction) throw new Error("Action correction is unavailable.");
        return deps.archiveGeneralAction({ actorUserId, generalActionId });
      },
      async undo(actorUserId, generalActionId) {
        if (!deps.archiveGeneralAction || !deps.getGeneralAction) {
          throw new Error("Action Undo is unavailable.");
        }
        const current = await deps.getGeneralAction({ ownerUserId: actorUserId, generalActionId });
        if (!current) throw new Error("That Action is no longer available.");
        if (current.status === "archived") return current;
        return deps.archiveGeneralAction({ actorUserId, generalActionId });
      },
    },
    followup: {
      async load(actorUserId, followupId) {
        const current = await deps.getFollowup?.({ ownerUserId: actorUserId, followupId });
        if (!current) throw new Error("That Follow-Up is no longer available.");
        if (!current.sourceRecordId) {
          throw new Error("That captured outcome has no source evidence to preserve.");
        }
        return {
          sourceRecordId: current.sourceRecordId,
          status: current.status,
          from: "Follow-Ups",
          personId: current.personId,
        };
      },
      async archive(actorUserId, followupId, status) {
        if (status === "archived")
          return deps.getFollowup?.({ ownerUserId: actorUserId, followupId });
        if (!deps.archiveFollowup) throw new Error("Follow-Up correction is unavailable.");
        return deps.archiveFollowup({ actorUserId, followupId });
      },
      async undo(actorUserId, followupId) {
        if (!deps.archiveFollowup || !deps.getFollowup) {
          throw new Error("Follow-Up Undo is unavailable.");
        }
        const current = await deps.getFollowup({ ownerUserId: actorUserId, followupId });
        if (!current) throw new Error("That Follow-Up is no longer available.");
        if (current.status === "archived") return current;
        return deps.archiveFollowup({ actorUserId, followupId });
      },
    },
  };
}
