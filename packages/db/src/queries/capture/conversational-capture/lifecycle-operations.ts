import type {
  AssetStatus,
  ConversationalCaptureChangeTarget,
  ConversationalCaptureUndoTarget,
  FollowupStatus,
  GeneralActionStatus,
  MemoryStatus,
  SavedItemStatus,
} from "@tendnote/domain";
import { hydrateSavedItem } from "../../saved-items/context";
import { createSavedItemLifecycle } from "../../saved-items/lifecycle";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import type { ConversationalCaptureDeps } from "./types";

export type CaptureOutcomeKind =
  | "saved_item"
  | "general_action"
  | "followup"
  | "person"
  | "memory"
  | "asset_review";
export type CaptureOutcomeReference = {
  kind: CaptureOutcomeKind;
  id: string;
  sourceRecordId?: string;
  createdByCapture?: boolean;
};
type CaptureOutcomeStatus =
  | SavedItemStatus
  | GeneralActionStatus
  | FollowupStatus
  | MemoryStatus
  | AssetStatus
  | "active";
type LoadedCaptureOutcome = {
  sourceRecordId: string;
  status: CaptureOutcomeStatus;
  from: "Saved Items" | "Actions" | "Routines" | "Follow-Ups" | "People" | "Memories" | "Review";
  personId?: string;
  content?: string;
};

type CaptureOutcomeLifecycleOperation = {
  load: (actorUserId: string, id: string, sourceRecordId?: string) => Promise<LoadedCaptureOutcome>;
  archive: (
    actorUserId: string,
    id: string,
    status: CaptureOutcomeStatus,
    reference?: CaptureOutcomeReference,
  ) => Promise<unknown>;
  undo: (actorUserId: string, id: string) => Promise<unknown>;
};

export function changeTargetReference(
  target: ConversationalCaptureChangeTarget,
): CaptureOutcomeReference {
  if (target.kind === "edit_saved_item") return { kind: "saved_item", id: target.savedItemId };
  if (target.kind === "edit_general_action") {
    return { kind: "general_action", id: target.generalActionId };
  }
  if (target.kind === "edit_followup") return { kind: "followup", id: target.followupId };
  if (target.kind === "edit_person") {
    return {
      kind: "person",
      id: target.personId,
      sourceRecordId: target.sourceRecordId,
      createdByCapture: target.createdByCapture,
    };
  }
  if (target.kind === "edit_memory") {
    return { kind: "memory", id: target.memoryId, sourceRecordId: target.sourceRecordId };
  }
  return { kind: "asset_review", id: target.groupId, sourceRecordId: target.sourceRecordId };
}

export function undoTargetReference(
  target: ConversationalCaptureUndoTarget,
): CaptureOutcomeReference {
  if (target.kind === "archive_saved_item") return { kind: "saved_item", id: target.savedItemId };
  if (target.kind === "archive_general_action") {
    return { kind: "general_action", id: target.generalActionId };
  }
  if (target.kind === "archive_followup") return { kind: "followup", id: target.followupId };
  if (target.kind === "archive_memory") return { kind: "memory", id: target.memoryId };
  return { kind: "asset_review", id: target.groupId };
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
        return (deps.archiveSavedItem ?? savedItemLifecycle.archiveSavedItem)({
          actorUserId,
          savedItemId,
        });
      },
      async undo(actorUserId, savedItemId) {
        const current = await store.getSavedItem({ ownerUserId: actorUserId, savedItemId });
        if (!current) throw new Error("That Saved Item is no longer available.");
        if (current.status === "archived") return hydrateSavedItem(store, current);
        return (deps.archiveSavedItem ?? savedItemLifecycle.archiveSavedItem)({
          actorUserId,
          savedItemId,
        });
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
    person: {
      async load(actorUserId, personId, sourceRecordId) {
        if (!sourceRecordId) throw new Error("That captured Person has no source evidence.");
        const current = await deps.getPerson?.({ ownerUserId: actorUserId, personId });
        if (!current) throw new Error("That Person is no longer available.");
        return {
          sourceRecordId,
          status: "active",
          from: "People",
          content: current.displayName,
        };
      },
      async archive(actorUserId, personId, _status, reference) {
        if (!reference?.sourceRecordId) {
          throw new Error("That captured Person has no source evidence.");
        }
        if (!reference.createdByCapture) {
          if (!deps.unlinkCapturedPerson) throw new Error("Person correction is unavailable.");
          const unlinked = await deps.unlinkCapturedPerson({
            ownerUserId: actorUserId,
            personId,
            sourceRecordId: reference.sourceRecordId,
          });
          if (!unlinked) throw new Error("That Person is no longer available.");
          return unlinked;
        }
        if (!deps.deleteCapturedPerson) throw new Error("Person correction is unavailable.");
        const removed = await deps.deleteCapturedPerson({
          ownerUserId: actorUserId,
          personId,
          sourceRecordId: reference.sourceRecordId,
        });
        if (!removed) throw new Error("That Person is no longer available.");
        return removed;
      },
      async undo() {
        throw new Error("A captured Person has no safe Undo operation.");
      },
    },
    memory: {
      async load(actorUserId, memoryId, sourceRecordId) {
        const current = await deps.getMemory?.({ ownerUserId: actorUserId, memoryId });
        if (!current) throw new Error("That Memory is no longer available.");
        const groundedBy = current.sourceRecordId ?? sourceRecordId;
        if (!groundedBy || (sourceRecordId && groundedBy !== sourceRecordId)) {
          throw new Error("That captured Memory has different source evidence.");
        }
        return {
          sourceRecordId: groundedBy,
          status: current.status,
          from: "Memories",
          personId: current.personId,
          content: current.content,
        };
      },
      async archive(actorUserId, memoryId, status) {
        if (status === "archived") return deps.getMemory?.({ ownerUserId: actorUserId, memoryId });
        if (!deps.archiveMemory) throw new Error("Memory correction is unavailable.");
        return deps.archiveMemory({ ownerUserId: actorUserId, memoryId });
      },
      async undo(actorUserId, memoryId) {
        const current = await deps.getMemory?.({ ownerUserId: actorUserId, memoryId });
        if (!current) throw new Error("That Memory is no longer available.");
        if (current.status === "archived") return current;
        if (!deps.archiveMemory) throw new Error("Memory Undo is unavailable.");
        return deps.archiveMemory({ ownerUserId: actorUserId, memoryId });
      },
    },
    asset_review: {
      async load(actorUserId, groupId, sourceRecordId) {
        const current = await deps.getAssetReview?.({ actorUserId, groupId });
        if (!current) throw new Error("That Asset review is no longer available.");
        const groundedBy = current.group.sourceRecordId ?? sourceRecordId;
        if (!groundedBy || (sourceRecordId && groundedBy !== sourceRecordId)) {
          throw new Error("That Asset review has different source evidence.");
        }
        return { sourceRecordId: groundedBy, status: current.asset.status, from: "Review" };
      },
      async archive(actorUserId, groupId, status) {
        if (status === "dismissed") return deps.getAssetReview?.({ actorUserId, groupId });
        if (!deps.dismissAssetReview) throw new Error("Asset review correction is unavailable.");
        return deps.dismissAssetReview({ actorUserId, groupId, source: "assistant" });
      },
      async undo(actorUserId, groupId) {
        const current = await deps.getAssetReview?.({ actorUserId, groupId });
        if (!current) throw new Error("That Asset review is no longer available.");
        if (current.asset.status === "dismissed") return current;
        if (!deps.dismissAssetReview) throw new Error("Asset review Undo is unavailable.");
        return deps.dismissAssetReview({ actorUserId, groupId, source: "assistant" });
      },
    },
  };
}
