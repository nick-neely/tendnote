import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  assertGeneralActionEditable,
  assertPausableRoutine,
  assertRecurrenceEditAllowed,
  assertResurfaceDate,
  type GeneralAction,
  type GeneralActionEventKind,
  type GeneralActionLifecycleAction,
  type GeneralActionStatus,
  GeneralActionValidationError,
  generalActionEditSchema,
  nextRoutineDueAt,
  resolveGeneralActionTransition,
} from "@tendnote/domain";
import {
  buildCreateGeneralActionValues,
  buildGeneralActionEditPatch,
  isEmptyGeneralActionEdit,
  resolveAreaId,
  resolveSourceRecordId,
  resolveVisibility,
  verifyOwnedPeople,
  writeShares,
} from "./attach";
import { makeScheduleGeneralActionEmbedding } from "./embed";
import { hydrateGeneralAction } from "./hydrate";
import type {
  CreateActiveGeneralActionInput,
  DeferGeneralActionInput,
  EditGeneralActionInput,
  GeneralActionActionInput,
  GeneralActionLifecycleDeps,
  GeneralActionLifecycleStore,
  GeneralActionPatch,
  GeneralActionWithContext,
  ListGeneralActionsInput,
  SetGeneralActionPeopleInput,
  SetGeneralActionVisibilityInput,
} from "./types";

const ACTIVE_STATUSES = [...ACTIVE_GENERAL_ACTION_STATUSES] as GeneralActionStatus[];

/** Maps a lifecycle action to the history event kind it records. */
const EVENT_KIND_FOR_ACTION: Record<GeneralActionLifecycleAction, GeneralActionEventKind> = {
  complete: "completed",
  defer: "deferred",
  dismiss: "dismissed",
  reopen: "reopened",
  archive: "archived",
  pause: "paused",
  resume: "resumed",
};

/**
 * Shared owner-scoped General Action lifecycle. This is the single source of truth
 * for creating and transitioning Actions (Phase 5 #178/#179/#180): the web Actions
 * surface (and, later, Eve) are thin callers over these functions so owner scoping,
 * scope-visibility, validated transitions, provenance, and lifecycle history never
 * fork between surfaces. General Actions are their own model, kept separate from
 * person-centered Follow-Ups (ADR 0143). An Action may optionally link people as
 * context without becoming a Follow-Up (ADR 0155) and carry lightweight asset hints
 * before Asset/Object Memory exists (ADR 0156).
 */
export function createGeneralActionLifecycle(
  store: GeneralActionLifecycleStore,
  deps: GeneralActionLifecycleDeps = {},
) {
  // Embed-on-write: content-affecting paths (create, edit) re-embed the action so
  // semantic retrieval stays matched to its current title/notes/cadence (ADR 0150).
  // Defaults to a no-op for stores/tests that do not exercise retrieval.
  const scheduleActionEmbedding = makeScheduleGeneralActionEmbedding(deps);

  /**
   * Loads an action the acting user may touch, or throws. It first tries an
   * owner-scoped read (the common private case), then falls back to a scope-visible
   * read so a household member can act on a shared or household action they can see
   * (ADR 0153). A not-found and a not-visible are indistinguishable on purpose —
   * fail closed, never confirm an action the caller may not see exists.
   */
  async function requireAction(input: GeneralActionActionInput): Promise<GeneralAction> {
    const action =
      (await store.getGeneralAction({
        ownerUserId: input.actorUserId,
        generalActionId: input.generalActionId,
      })) ??
      (await store.getVisibleGeneralAction({
        callerUserId: input.actorUserId,
        generalActionId: input.generalActionId,
      }));

    if (!action) {
      throw new Error("Action not found.");
    }

    return action;
  }

  /**
   * Loads an action the acting user *owns*, or throws. Owner-only operations —
   * changing visibility scope or editing people links — never fall back to a
   * scope-visible read: a member who can see a household action must not be able to
   * re-scope it or rewrite whose people it links (fail closed; ADR 0153).
   */
  async function requireOwnedAction(input: GeneralActionActionInput): Promise<GeneralAction> {
    const action = await store.getGeneralAction({
      ownerUserId: input.actorUserId,
      generalActionId: input.generalActionId,
    });
    if (!action) {
      throw new Error("Action not found.");
    }
    return action;
  }

  /** Hydrates an action with linked people and scope audience detail (see {@link hydrateGeneralAction}). */
  function hydrate(action: GeneralAction): Promise<GeneralActionWithContext> {
    return hydrateGeneralAction(store, action);
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
   * Applies a status transition, records the actor on the record and in history, and
   * clears state that no longer applies (a resurface date once the action leaves
   * `deferred`, the completion time once it is reopened). The record's owner keys the
   * write; the acting user is stamped as the actor, so a member acting on a household
   * action preserves owner provenance while recording who did it (ADRs 0153, 0154).
   */
  async function transition(
    input: GeneralActionActionInput,
    action: GeneralActionLifecycleAction,
    patchExtra: GeneralActionPatch = {},
    detail: Record<string, unknown> = {},
    preloaded?: GeneralAction,
  ) {
    const current = preloaded ?? (await requireAction(input));
    const status = resolveGeneralActionTransition(current.status, action);

    const updated = await store.updateGeneralAction({
      ownerUserId: current.ownerUserId,
      generalActionId: current.id,
      patch: { status, lastActorUserId: input.actorUserId, ...patchExtra },
    });

    await recordEvent(updated, EVENT_KIND_FOR_ACTION[action], input.actorUserId, {
      previousStatus: current.status,
      status: updated.status,
      ...detail,
    });

    return hydrate(updated);
  }

  return {
    /**
     * Creates a one-time Action as `open`, with creator and actor provenance and a
     * `created` history event. A due date is optional — an Action may be unscheduled
     * (ADR 0149). Visibility defaults to private and fail-closed (ADR 0153); a
     * grounding source record, a filed Area, linked people, and asset hints are each
     * verified before they attach (ADRs 0154, 0155, 0156, 0164).
     */
    async createGeneralAction(input: CreateActiveGeneralActionInput) {
      const sourceRecordId = await resolveSourceRecordId(
        store,
        input.ownerUserId,
        input.sourceRecordId,
      );
      const areaId = await resolveAreaId(store, input.ownerUserId, input.areaId ?? null);
      const { scope, householdId } = await resolveVisibility(store, input);
      const personIds = input.personIds
        ? await verifyOwnedPeople(store, input.ownerUserId, input.personIds)
        : [];
      const assetHints = input.assetHints ?? [];

      const actionValues = buildCreateGeneralActionValues(input, {
        status: "open",
        sourceRecordId,
        areaId,
        scope,
        householdId,
      });
      const action = await store.createGeneralActionBundle({
        action: actionValues,
        personIds,
        sharedWithUserIds: scope === "shared" ? (input.selectedUserIds ?? []) : [],
        event: {
          ownerUserId: input.ownerUserId,
          kind: "created",
          actorUserId: input.ownerUserId,
          detailJson: {
            scope: actionValues.scope,
            status: actionValues.status,
            grounded: sourceRecordId !== null,
            filed: areaId !== null,
            peopleLinked: personIds.length,
            assetHints: assetHints.length,
            // Whether this is a Routine (recurring) or a one-time Action (ADR 0148).
            recurring: actionValues.recurrence !== null,
          },
        },
      });

      await scheduleActionEmbedding(action);

      return hydrate(action);
    },

    /**
     * Edits an Action's user-facing content (title, notes, due date, links, asset
     * hints, Area) in place with no status change. `undefined` fields are untouched;
     * explicit `null` clears notes or the due date. Editing a terminal Action is
     * rejected. Owner-only: authoring an Action's content is the owner's; a member who
     * can see a shared/household action may *act* on it (complete, set aside, dismiss,
     * archive) but never rewrite it, so its content and provenance stay the owner's
     * (ADR 0153, the view-and-act reading — act, not re-author).
     */
    async editGeneralAction(input: EditGeneralActionInput) {
      const action = await requireOwnedAction(input);

      assertGeneralActionEditable(action.status);
      const edit = generalActionEditSchema.parse(input.edit);

      // A no-op edit would still write a misleading history row, so require at
      // least one field to actually be present.
      if (isEmptyGeneralActionEdit(edit)) {
        throw new GeneralActionValidationError(
          "An action edit must change the title, notes, due date, cadence, links, area, or asset hints.",
        );
      }
      if (edit.recurrence !== undefined) {
        // A paused Routine can't have its cadence removed in place — that would leave
        // a paused one-time Action (ADR 0148). Resume first.
        assertRecurrenceEditAllowed(action.status, edit.recurrence);
      }

      const patch: GeneralActionPatch = {
        lastActorUserId: input.actorUserId,
        ...(await buildGeneralActionEditPatch(store, action.ownerUserId, edit)),
      };

      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch,
      });

      await recordEvent(updated, "edited", input.actorUserId, {
        editedTitle: edit.title !== undefined,
        editedNotes: edit.notes !== undefined,
        editedDueAt: edit.dueAt !== undefined,
        editedLinks: edit.links !== undefined,
        editedAssetHints: edit.assetHints !== undefined,
        editedArea: edit.areaId !== undefined,
        editedRecurrence: edit.recurrence !== undefined,
      });

      // Re-embed: title, notes, asset hints, or cadence may have changed, so the stored
      // vector must be refreshed to match (ADR 0150).
      await scheduleActionEmbedding(updated);

      return hydrate(updated);
    },

    /**
     * Re-scopes an Action's visibility in place — the private/shared/household
     * transition. Owner-only: a viewing member can act on an action but never widen
     * or narrow its audience. Narrowing clears the household's shares first so the
     * change is fail-closed; widening to shared writes fresh shares (ADR 0153).
     *
     * Deliberately allowed in any lifecycle state, including terminal (completed,
     * dismissed, archived): visibility is orthogonal to lifecycle, and tightening who
     * could see a resolved action is a privacy move we never want to block. Widening a
     * resolved action is harmless — it stays out of active views regardless.
     */
    async setGeneralActionVisibility(input: SetGeneralActionVisibilityInput) {
      const action = await requireOwnedAction(input);
      const { scope, householdId } = await resolveVisibility(store, {
        // Owner-only path: requireOwnedAction guarantees actor == owner, so passing the
        // actor as the visibility guard's ownerUserId resolves the owner's household.
        ownerUserId: input.actorUserId,
        scope: input.scope,
        householdId: input.householdId,
        selectedUserIds: input.selectedUserIds,
      });

      // Clear any existing shares before applying the new scope so a member dropped
      // from the audience — or all members, on a narrow to private/household — loses
      // visibility rather than keeping a stale share.
      if (action.householdId) {
        await store.deleteHouseholdRecordShares({
          householdId: action.householdId,
          recordKind: "general_action",
          recordId: action.id,
        });
      }

      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: { scope, householdId, lastActorUserId: input.actorUserId },
      });

      if (scope === "shared" && householdId) {
        await writeShares(store, {
          householdId,
          actionId: action.id,
          // Owner-only path (requireOwnedAction): actor == owner, so the shares are
          // written as the owner.
          ownerUserId: input.actorUserId,
          selectedUserIds: input.selectedUserIds ?? [],
        });
      }

      await recordEvent(updated, "edited", input.actorUserId, {
        editedVisibility: true,
        scope: updated.scope,
        previousScope: action.scope,
      });

      return hydrate(updated);
    },

    /**
     * Replaces an Action's people links with exactly `personIds` (each owner-owned).
     * Owner-only, and rejected on a terminal Action like other content edits. Linking
     * a person is context, not a Follow-Up conversion (ADR 0155).
     */
    async setGeneralActionPeople(input: SetGeneralActionPeopleInput) {
      const action = await requireOwnedAction(input);
      assertGeneralActionEditable(action.status);
      const personIds = await verifyOwnedPeople(store, input.actorUserId, input.personIds);

      await store.setGeneralActionPeople({
        // Owner-only path (requireOwnedAction): actor == owner, so the link set is
        // rewritten under the owner's key.
        ownerUserId: input.actorUserId,
        generalActionId: action.id,
        personIds,
      });
      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: { lastActorUserId: input.actorUserId },
      });

      await recordEvent(updated, "edited", input.actorUserId, {
        editedPeople: true,
        peopleLinked: personIds.length,
      });

      return hydrate(updated);
    },

    /**
     * Completes an Action. For a one-time Action this is terminal — it moves to
     * `completed` with a completion timestamp. For a Routine it is not: completing an
     * occurrence rolls the due date forward one cadence step (anchored on the
     * completion moment) and keeps the Routine `open`, so it simply comes back next
     * cycle. The completion is still written to history, so a Routine's completion
     * trail is preserved without any streak or scoring (ADRs 0147, 0165). Whoever can
     * see the Action may complete it — a household member completing a shared Routine
     * occurrence works, keyed on the owner while recording the member as actor (ADR
     * 0153).
     */
    async completeGeneralAction(input: GeneralActionActionInput) {
      const current = await requireAction(input);
      if (current.recurrence === null) {
        return transition(
          input,
          "complete",
          { completedAt: new Date(), deferUntil: null },
          {},
          current,
        );
      }

      // Routine: validate the occurrence is completable from its current state
      // (open/deferred, never paused/terminal), then roll forward instead of retiring.
      resolveGeneralActionTransition(current.status, "complete");
      const completedAt = new Date();
      const nextDueAt = nextRoutineDueAt(current.recurrence, completedAt);
      const updated = await store.updateGeneralAction({
        ownerUserId: current.ownerUserId,
        generalActionId: current.id,
        patch: {
          status: "open",
          dueAt: nextDueAt,
          deferUntil: null,
          completedAt: null,
          lastActorUserId: input.actorUserId,
        },
      });
      await recordEvent(updated, "completed", input.actorUserId, {
        previousStatus: current.status,
        status: updated.status,
        rolledForward: true,
        occurrenceCompletedAt: completedAt.toISOString(),
        previousDueAt: current.dueAt ? current.dueAt.toISOString() : null,
        nextDueAt: nextDueAt.toISOString(),
      });
      return hydrate(updated);
    },

    dismissGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "dismiss", { deferUntil: null });
    },

    /**
     * Pauses a Routine — sets it aside without retiring it, so it stops surfacing and
     * stops rolling forward until resumed. Routine-only: a one-time Action has nothing
     * recurring to suspend and is rejected (ADRs 0147, 0148). Whoever can see the
     * Routine may pause it, like the other lifecycle actions. Clears any resurface date
     * on the way out, like the other transitions that leave `deferred`, so a stale
     * `deferUntil` can't corrupt the resumed row's surfacing order.
     */
    async pauseGeneralAction(input: GeneralActionActionInput) {
      const current = await requireAction(input);
      assertPausableRoutine(current);
      return transition(input, "pause", { deferUntil: null }, {}, current);
    },

    /**
     * Resumes a paused Routine back to `open` so its cadence surfaces it again. If it
     * was paused past its due date, the due date is rolled forward one cadence step
     * from the resume moment — mirroring the completion path — so a resumed Routine
     * reads "next due <date>" rather than re-surfacing as overdue for a gap the user
     * deliberately paused (calm register; a paused stretch is not a missed occurrence).
     * A future or absent due date is left untouched: only an overdue one is rolled.
     */
    async resumeGeneralAction(input: GeneralActionActionInput) {
      const current = await requireAction(input);
      const patch: GeneralActionPatch = {};
      const detail: Record<string, unknown> = {};
      const now = new Date();
      if (current.recurrence && current.dueAt && current.dueAt.getTime() < now.getTime()) {
        const nextDueAt = nextRoutineDueAt(current.recurrence, now);
        patch.dueAt = nextDueAt;
        detail.rolledForward = true;
        detail.previousDueAt = current.dueAt.toISOString();
        detail.nextDueAt = nextDueAt.toISOString();
      }
      return transition(input, "resume", patch, detail, current);
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
        { actorUserId: input.actorUserId, generalActionId: input.generalActionId },
        "defer",
        { deferUntil },
        { deferUntil: deferUntil.toISOString() },
      );
    },

    /**
     * The active (open or deferred) Actions the caller may see — their own plus the
     * household and selected-shared ones owned by active co-members. Scope filtering
     * is applied pre-retrieval by the store, so nothing out of scope reaches the
     * surface (#178/#180). Each is hydrated with its linked people.
     */
    async listActiveGeneralActions(input: ListGeneralActionsInput) {
      const actions = await store.listVisibleGeneralActionsForCaller({
        callerUserId: input.ownerUserId,
        statuses: ACTIVE_STATUSES,
        limit: input.limit,
      });
      return Promise.all(actions.map((action) => hydrate(action)));
    },

    /**
     * The caller's recently resolved (completed or dismissed) Actions they may see,
     * kept quietly reachable for reopen. Archived Actions are soft-removed and
     * excluded here.
     */
    async listResolvedGeneralActions(input: ListGeneralActionsInput) {
      const actions = await store.listVisibleGeneralActionsForCaller({
        callerUserId: input.ownerUserId,
        statuses: ["completed", "dismissed"],
        limit: input.limit,
      });
      return Promise.all(actions.map((action) => hydrate(action)));
    },

    /**
     * The caller's paused Routines (their own plus visible shared/household ones),
     * kept reachable to resume or archive. Paused is not an active status, so these
     * never appear in the active list or on proactive surfaces — a paused Routine is
     * deliberately quiet until the owner brings it back (ADR 0148).
     */
    async listPausedGeneralActions(input: ListGeneralActionsInput) {
      const actions = await store.listVisibleGeneralActionsForCaller({
        callerUserId: input.ownerUserId,
        statuses: ["paused"],
        limit: input.limit,
      });
      return Promise.all(actions.map((action) => hydrate(action)));
    },

    async getGeneralAction(input: GeneralActionActionInput) {
      return hydrate(await requireAction(input));
    },

    /**
     * The append-only lifecycle history for one Action, oldest first. Visible-scoped
     * and fail-closed: an action the caller cannot see (a stranger's, or another
     * household's) returns an empty history rather than leaking that it exists — the
     * caller simply sees nothing (ADR 0153). A visible member reads history keyed on
     * the record's true owner.
     */
    async listGeneralActionHistory(input: GeneralActionActionInput) {
      const action =
        (await store.getGeneralAction({
          ownerUserId: input.actorUserId,
          generalActionId: input.generalActionId,
        })) ??
        (await store.getVisibleGeneralAction({
          callerUserId: input.actorUserId,
          generalActionId: input.generalActionId,
        }));
      if (!action) {
        return [];
      }
      return store.listGeneralActionEvents({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
      });
    },
  };
}
