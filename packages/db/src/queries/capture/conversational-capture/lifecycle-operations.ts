import {
  type AssetStatus,
  type ContextFactLifecycle,
  type ConversationalCaptureChangeTarget,
  ConversationalCaptureUndoError,
  type ConversationalCaptureUndoTarget,
  type FollowupStatus,
  type GeneralActionStatus,
  type MemoryStatus,
  type SavedItemStatus,
} from "@tendnote/domain";
import type { AffectedScope } from "../../affected-scopes";
import { hydrateSavedItem } from "../../saved-items/context";
import { createSavedItemLifecycle } from "../../saved-items/lifecycle";
import { createAffectedSavedItemLifecycle } from "../../saved-items/mutation-lifecycle";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import type { CaptureContextFact, ConversationalCaptureDeps } from "./types";

export type CaptureOutcomeKind =
  | "saved_item"
  | "general_action"
  | "followup"
  | "person"
  | "memory"
  | "asset_review"
  | "context_fact";
export type CaptureOutcomeReference = {
  kind: CaptureOutcomeKind;
  id: string;
  sourceRecordId?: string;
  createdByCapture?: boolean;
  inverse?: {
    category: Exclude<import("@tendnote/domain").ContextFactCategory, "composition">;
    content: string;
    sensitivity: import("@tendnote/domain").ContextFactSensitivity;
  };
  expectedUpdatedAt?: Date;
};
type CaptureOutcomeStatus =
  | SavedItemStatus
  | GeneralActionStatus
  | FollowupStatus
  | MemoryStatus
  | AssetStatus
  | ContextFactLifecycle
  | "active";
type LoadedCaptureOutcome = {
  sourceRecordId: string;
  status: CaptureOutcomeStatus;
  from:
    | "Saved Items"
    | "Actions"
    | "Routines"
    | "Follow-Ups"
    | "People"
    | "Memories"
    | "Review"
    | "Self Context";
  personId?: string;
  content?: string;
  category?: CaptureContextFact["category"];
  sensitivity?: CaptureContextFact["sensitivity"];
  updatedAt?: Date;
};

/**
 * Whether the inverse ran in *this* call.
 *
 * Undo is idempotent — a second Undo of an already-archived outcome is a
 * deliberate no-op, not a failure — but "I undid that" and "that was already
 * undone" are different sentences to a person, and the caller cannot tell them
 * apart from the record alone (both end archived). So the operation says which
 * one happened rather than leaving every caller to guess from an empty
 * `affectedScopes`, which is an inference, not a contract.
 */
export type CaptureOutcomeUndoOutcome = "undone" | "already_undone";

export type CaptureOutcomeUndoResult = {
  outcome: CaptureOutcomeUndoOutcome;
  /** The record in its post-Undo state, unwrapped from any mutation outcome. */
  result: unknown;
  affectedScopes: AffectedScope[];
};

/** The inverse ran now: carry through whatever the mutation reported. */
function appliedUndo(value: unknown): CaptureOutcomeUndoResult {
  if (value && typeof value === "object" && "result" in value) {
    const scopes = "affectedScopes" in value ? value.affectedScopes : undefined;
    return {
      outcome: "undone",
      result: value.result,
      affectedScopes: Array.isArray(scopes) ? (scopes as AffectedScope[]) : [],
    };
  }
  return { outcome: "undone", result: value, affectedScopes: [] };
}

/** The record already held the undone state, so nothing changed and nothing is affected. */
function alreadyUndone(result: unknown): CaptureOutcomeUndoResult {
  return { outcome: "already_undone", result, affectedScopes: [] };
}

type CaptureOutcomeLifecycleOperation = {
  load: (actorUserId: string, id: string, sourceRecordId?: string) => Promise<LoadedCaptureOutcome>;
  archive: (
    actorUserId: string,
    id: string,
    status: CaptureOutcomeStatus,
    reference?: CaptureOutcomeReference,
  ) => Promise<unknown>;
  undo: (
    actorUserId: string,
    id: string,
    reference?: CaptureOutcomeReference,
  ) => Promise<CaptureOutcomeUndoResult>;
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
  if (target.kind === "edit_context_fact") {
    return {
      kind: "context_fact",
      id: target.contextFactId,
      sourceRecordId: target.sourceRecordId,
      ...(target.expectedUpdatedAt
        ? { expectedUpdatedAt: new Date(target.expectedUpdatedAt) }
        : {}),
    };
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
  if (target.kind === "archive_context_fact") {
    return {
      kind: "context_fact",
      id: target.contextFactId,
      sourceRecordId: target.sourceRecordId,
      ...(target.expectedUpdatedAt
        ? { expectedUpdatedAt: new Date(target.expectedUpdatedAt) }
        : {}),
    };
  }
  if (target.kind === "edit_context_fact") {
    return {
      kind: "context_fact",
      id: target.contextFactId,
      sourceRecordId: target.sourceRecordId,
      inverse: {
        category: target.category,
        content: target.content,
        sensitivity: target.sensitivity,
      },
      ...(target.expectedUpdatedAt
        ? { expectedUpdatedAt: new Date(target.expectedUpdatedAt) }
        : {}),
    };
  }
  return { kind: "asset_review", id: target.groupId };
}

const CONTEXT_FACT_SOURCE_MISMATCH = "That Self Context fact has different source evidence.";

function hasSelfContextFactSource(
  current: CaptureContextFact,
  sourceRecordId: string | undefined,
): boolean {
  return Boolean(sourceRecordId) && current.provenance.sourceRecordId === sourceRecordId;
}

function assertSelfContextFactSource(
  current: CaptureContextFact,
  sourceRecordId: string | undefined,
) {
  if (!hasSelfContextFactSource(current, sourceRecordId)) {
    throw new Error(CONTEXT_FACT_SOURCE_MISMATCH);
  }
}

async function restoreSelfContextFactForCapture(input: {
  deps: ConversationalCaptureDeps;
  actorUserId: string;
  contextFactId: string;
  current: CaptureContextFact;
  reference: CaptureOutcomeReference;
}): Promise<CaptureOutcomeUndoResult> {
  if (!input.deps.updateSelfContextFact) {
    throw new ConversationalCaptureUndoError("refused", "Self Context Undo is unavailable.");
  }
  if (input.current.lifecycle !== "active") {
    throw new ConversationalCaptureUndoError(
      "refused",
      "That Self Context fact is no longer active.",
    );
  }
  const inverse = input.reference.inverse;
  if (!inverse) {
    throw new ConversationalCaptureUndoError("refused", "Self Context Undo is unavailable.");
  }
  return appliedUndo(
    await input.deps.updateSelfContextFact({
      actorUserId: input.actorUserId,
      contextFactId: input.contextFactId,
      category: inverse.category,
      content: inverse.content,
      sensitivity: inverse.sensitivity,
      expectedUpdatedAt: input.reference.expectedUpdatedAt ?? input.current.updatedAt,
    }),
  );
}

async function archiveSelfContextFactForCapture(input: {
  deps: ConversationalCaptureDeps;
  actorUserId: string;
  contextFactId: string;
  current: CaptureContextFact;
  reference?: CaptureOutcomeReference;
}): Promise<CaptureOutcomeUndoResult> {
  if (input.current.lifecycle === "archived") return alreadyUndone(input.current);
  if (!input.deps.archiveSelfContextFact) {
    throw new ConversationalCaptureUndoError("refused", "Self Context Undo is unavailable.");
  }
  return appliedUndo(
    await input.deps.archiveSelfContextFact({
      actorUserId: input.actorUserId,
      contextFactId: input.contextFactId,
      expectedUpdatedAt: input.reference?.expectedUpdatedAt ?? input.current.updatedAt,
    }),
  );
}

async function undoSelfContextFactForCapture(input: {
  deps: ConversationalCaptureDeps;
  actorUserId: string;
  contextFactId: string;
  reference?: CaptureOutcomeReference;
}): Promise<CaptureOutcomeUndoResult> {
  if (!input.deps.getSelfContextFact) {
    throw new ConversationalCaptureUndoError("refused", "Self Context Undo is unavailable.");
  }
  const current = await input.deps.getSelfContextFact({
    ownerUserId: input.actorUserId,
    contextFactId: input.contextFactId,
  });
  if (!current) {
    throw new ConversationalCaptureUndoError(
      "not_found",
      "That Self Context fact is no longer available.",
    );
  }
  if (!hasSelfContextFactSource(current, input.reference?.sourceRecordId)) {
    throw new ConversationalCaptureUndoError("refused", CONTEXT_FACT_SOURCE_MISMATCH);
  }
  if (input.reference?.inverse) {
    return restoreSelfContextFactForCapture({
      ...input,
      current,
      reference: input.reference,
    });
  }
  return archiveSelfContextFactForCapture({ ...input, current });
}

export function createCaptureOutcomeLifecycleOperations(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps,
): Record<CaptureOutcomeKind, CaptureOutcomeLifecycleOperation> {
  const savedItemLifecycle = createAffectedSavedItemLifecycle(createSavedItemLifecycle(store));
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
          return { result: await hydrateSavedItem(store, current), affectedScopes: [] };
        }
        return (deps.archiveSavedItem ?? savedItemLifecycle.archiveSavedItem)({
          actorUserId,
          savedItemId,
        });
      },
      async undo(actorUserId, savedItemId) {
        const current = await store.getSavedItem({ ownerUserId: actorUserId, savedItemId });
        if (!current) {
          throw new ConversationalCaptureUndoError(
            "not_found",
            "That Saved Item is no longer available.",
          );
        }
        if (current.status === "archived") {
          return alreadyUndone(await hydrateSavedItem(store, current));
        }
        return appliedUndo(
          await (deps.archiveSavedItem ?? savedItemLifecycle.archiveSavedItem)({
            actorUserId,
            savedItemId,
          }),
        );
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
          throw new ConversationalCaptureUndoError("refused", "Action Undo is unavailable.");
        }
        const current = await deps.getGeneralAction({ ownerUserId: actorUserId, generalActionId });
        if (!current) {
          throw new ConversationalCaptureUndoError(
            "not_found",
            "That Action is no longer available.",
          );
        }
        if (current.status === "archived") return alreadyUndone(current);
        return appliedUndo(await deps.archiveGeneralAction({ actorUserId, generalActionId }));
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
          throw new ConversationalCaptureUndoError("refused", "Follow-Up Undo is unavailable.");
        }
        const current = await deps.getFollowup({ ownerUserId: actorUserId, followupId });
        if (!current) {
          throw new ConversationalCaptureUndoError(
            "not_found",
            "That Follow-Up is no longer available.",
          );
        }
        if (current.status === "archived") return alreadyUndone(current);
        return appliedUndo(await deps.archiveFollowup({ actorUserId, followupId }));
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
        const outcome = await deps.deleteCapturedPerson({
          ownerUserId: actorUserId,
          personId,
          sourceRecordId: reference.sourceRecordId,
        });
        if (!outcome.result) throw new Error("That Person is no longer available.");
        return outcome;
      },
      async undo(): Promise<CaptureOutcomeUndoResult> {
        throw new ConversationalCaptureUndoError(
          "refused",
          "A captured Person has no safe Undo operation.",
        );
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
        if (!current) {
          throw new ConversationalCaptureUndoError(
            "not_found",
            "That Memory is no longer available.",
          );
        }
        if (current.status === "archived") return alreadyUndone(current);
        if (!deps.archiveMemory) {
          throw new ConversationalCaptureUndoError("refused", "Memory Undo is unavailable.");
        }
        return appliedUndo(await deps.archiveMemory({ ownerUserId: actorUserId, memoryId }));
      },
    },
    context_fact: {
      async load(actorUserId, contextFactId, sourceRecordId) {
        const current = await deps.getSelfContextFact?.({
          ownerUserId: actorUserId,
          contextFactId,
        });
        if (!current) throw new Error("That Self Context fact is no longer available.");
        const groundedBy = current.provenance.sourceRecordId;
        if (!groundedBy || !sourceRecordId || groundedBy !== sourceRecordId) {
          throw new Error("That Self Context fact has different source evidence.");
        }
        return {
          sourceRecordId: groundedBy,
          status: current.lifecycle,
          from: "Self Context" as const,
          category: current.category,
          content: current.content,
          sensitivity: current.sensitivity,
          updatedAt: current.updatedAt,
        };
      },
      async archive(actorUserId, contextFactId, status, reference) {
        if (!deps.getSelfContextFact || !deps.archiveSelfContextFact) {
          throw new Error("Self Context correction is unavailable.");
        }
        const current = await deps.getSelfContextFact({
          ownerUserId: actorUserId,
          contextFactId,
        });
        if (!current) throw new Error("That Self Context fact is no longer available.");
        assertSelfContextFactSource(current, reference?.sourceRecordId);
        if (status === "archived" || current.lifecycle === "archived") return current;
        return deps.archiveSelfContextFact({
          actorUserId,
          contextFactId,
          expectedUpdatedAt: reference?.expectedUpdatedAt ?? current.updatedAt,
        });
      },
      async undo(actorUserId, contextFactId, reference) {
        return undoSelfContextFactForCapture({
          deps,
          actorUserId,
          contextFactId,
          reference,
        });
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
        if (!current) {
          throw new ConversationalCaptureUndoError(
            "not_found",
            "That Asset review is no longer available.",
          );
        }
        if (current.asset.status === "dismissed") return alreadyUndone(current);
        if (!deps.dismissAssetReview) {
          throw new ConversationalCaptureUndoError("refused", "Asset review Undo is unavailable.");
        }
        return appliedUndo(
          await deps.dismissAssetReview({ actorUserId, groupId, source: "assistant" }),
        );
      },
    },
  };
}
