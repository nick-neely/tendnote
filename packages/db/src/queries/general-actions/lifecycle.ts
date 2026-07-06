import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  assertGeneralActionEditable,
  assertResurfaceDate,
  type GeneralAction,
  type GeneralActionEventKind,
  type GeneralActionLifecycleAction,
  type GeneralActionStatus,
  GeneralActionValidationError,
  generalActionEditSchema,
  resolveGeneralActionTransition,
} from "@tendnote/domain";
import type {
  CreateActiveGeneralActionInput,
  DeferGeneralActionInput,
  EditGeneralActionInput,
  GeneralActionActionInput,
  GeneralActionLifecycleStore,
  GeneralActionPatch,
  ListGeneralActionsInput,
} from "./types";

const ACTIVE_STATUSES = [...ACTIVE_GENERAL_ACTION_STATUSES] as GeneralActionStatus[];

/** Maps a lifecycle action to the history event kind it records. */
const EVENT_KIND_FOR_ACTION: Record<GeneralActionLifecycleAction, GeneralActionEventKind> = {
  complete: "completed",
  defer: "deferred",
  dismiss: "dismissed",
  reopen: "reopened",
  archive: "archived",
};

/**
 * Shared owner-scoped General Action lifecycle. This is the single source of truth
 * for creating and transitioning one-time private Actions (Phase 5 #178): the web
 * Actions surface (and, later, Eve) are thin callers over these functions so owner
 * scoping, validated transitions, provenance, and lifecycle history never fork
 * between surfaces. General Actions are their own model, kept separate from
 * person-centered Follow-Ups (ADR 0143).
 */
export function createGeneralActionLifecycle(store: GeneralActionLifecycleStore) {
  /** Loads an owner-scoped action or throws so callers cannot touch another owner's. */
  async function requireAction(input: GeneralActionActionInput): Promise<GeneralAction> {
    const action = await store.getGeneralAction(input);

    if (!action) {
      throw new Error("Action not found.");
    }

    return action;
  }

  async function recordEvent(
    action: GeneralAction,
    kind: GeneralActionEventKind,
    actorUserId: string,
    detail: Record<string, unknown>,
  ) {
    await store.createGeneralActionEvent({
      generalActionId: action.id,
      ownerUserId: action.ownerUserId,
      kind,
      actorUserId,
      detailJson: detail,
    });
  }

  /**
   * Applies a status transition, records the actor on the record and in history,
   * and clears state that no longer applies (a resurface date once the action
   * leaves `deferred`, the completion time once it is reopened).
   */
  async function transition(
    input: GeneralActionActionInput,
    action: GeneralActionLifecycleAction,
    patchExtra: GeneralActionPatch = {},
    detail: Record<string, unknown> = {},
  ) {
    const current = await requireAction(input);
    const status = resolveGeneralActionTransition(current.status, action);

    const updated = await store.updateGeneralAction({
      ownerUserId: current.ownerUserId,
      generalActionId: current.id,
      patch: { status, lastActorUserId: input.ownerUserId, ...patchExtra },
    });

    await recordEvent(updated, EVENT_KIND_FOR_ACTION[action], input.ownerUserId, {
      previousStatus: current.status,
      status: updated.status,
      ...detail,
    });

    return updated;
  }

  return {
    /**
     * Creates a private one-time Action as `open`, with creator and actor
     * provenance and a `created` history event. A due date is optional — an Action
     * may be unscheduled (ADR 0149). When a source record grounds the action it is
     * verified owner-visible first (ADRs 0154, 0164).
     */
    async createGeneralAction(input: CreateActiveGeneralActionInput) {
      let sourceRecordId: string | null = null;
      if (input.sourceRecordId) {
        const sourceRecord = await store.getSourceRecord({
          ownerUserId: input.ownerUserId,
          sourceRecordId: input.sourceRecordId,
        });
        if (!sourceRecord) {
          throw new Error("Source record not found.");
        }
        sourceRecordId = sourceRecord.id;
      }

      const action = await store.createGeneralAction({
        ownerUserId: input.ownerUserId,
        title: input.title,
        notes: input.notes ?? null,
        links: input.links ?? [],
        status: "open",
        dueAt: input.dueAt ?? null,
        deferUntil: null,
        sourceRecordId,
        scope: "private",
        householdId: null,
        createdByUserId: input.ownerUserId,
        lastActorUserId: input.ownerUserId,
        completedAt: null,
      });

      await recordEvent(action, "created", input.ownerUserId, {
        scope: action.scope,
        status: action.status,
        grounded: sourceRecordId !== null,
      });

      return action;
    },

    /**
     * Edits an Action's user-facing content (title, notes, due date, links) in
     * place with no status change. `undefined` fields are untouched; explicit
     * `null` clears notes or the due date. Editing a terminal Action is rejected.
     */
    async editGeneralAction(input: EditGeneralActionInput) {
      const action = await requireAction(input);

      assertGeneralActionEditable(action.status);
      const edit = generalActionEditSchema.parse(input.edit);

      // A no-op edit would still write a misleading history row, so require at
      // least one field to actually be present.
      if (
        edit.title === undefined &&
        edit.notes === undefined &&
        edit.dueAt === undefined &&
        edit.links === undefined
      ) {
        throw new GeneralActionValidationError(
          "An action edit must change the title, notes, due date, or links.",
        );
      }

      const patch: GeneralActionPatch = { lastActorUserId: input.ownerUserId };
      if (edit.title !== undefined) {
        patch.title = edit.title;
      }
      if (edit.notes !== undefined) {
        patch.notes = edit.notes;
      }
      if (edit.dueAt !== undefined) {
        patch.dueAt = edit.dueAt;
      }
      if (edit.links !== undefined) {
        patch.links = edit.links;
      }

      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch,
      });

      await recordEvent(updated, "edited", input.ownerUserId, {
        editedTitle: edit.title !== undefined,
        editedNotes: edit.notes !== undefined,
        editedDueAt: edit.dueAt !== undefined,
        editedLinks: edit.links !== undefined,
      });

      return updated;
    },

    completeGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "complete", { completedAt: new Date(), deferUntil: null });
    },

    dismissGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "dismiss", { deferUntil: null });
    },

    reopenGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "reopen", { completedAt: null, deferUntil: null });
    },

    archiveGeneralAction(input: GeneralActionActionInput) {
      // Clear the resurface date on the way out, like the other terminal
      // transitions — an archived action never resurfaces.
      return transition(input, "archive", { deferUntil: null });
    },

    /** Defers an active Action to a concrete resurface date so it comes back later. */
    async deferGeneralAction(input: DeferGeneralActionInput) {
      const deferUntil = assertResurfaceDate(input.deferUntil);
      return transition(
        { ownerUserId: input.ownerUserId, generalActionId: input.generalActionId },
        "defer",
        { deferUntil },
        { deferUntil: deferUntil.toISOString() },
      );
    },

    /** The owner's active (open or deferred) Actions for the Actions surface. */
    async listActiveGeneralActions(input: ListGeneralActionsInput) {
      return store.listGeneralActionsForOwner({
        ownerUserId: input.ownerUserId,
        statuses: ACTIVE_STATUSES,
        limit: input.limit,
      });
    },

    /**
     * The owner's recently resolved (completed or dismissed) Actions, kept quietly
     * reachable for reopen. Archived Actions are soft-removed and excluded here.
     */
    async listResolvedGeneralActions(input: ListGeneralActionsInput) {
      return store.listGeneralActionsForOwner({
        ownerUserId: input.ownerUserId,
        statuses: ["completed", "dismissed"],
        limit: input.limit,
      });
    },

    getGeneralAction(input: GeneralActionActionInput) {
      return requireAction(input);
    },

    /** The append-only lifecycle history for one Action, oldest first. */
    listGeneralActionHistory(input: GeneralActionActionInput) {
      return store.listGeneralActionEvents(input);
    },
  };
}
