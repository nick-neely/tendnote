import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  assertAreaNotArchived,
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
  type PrivacyScope,
  resolveGeneralActionTransition,
} from "@tendnote/domain";
import type {
  CreateActiveGeneralActionInput,
  DeferGeneralActionInput,
  EditGeneralActionInput,
  GeneralActionActionInput,
  GeneralActionLifecycleStore,
  GeneralActionPatch,
  GeneralActionPersonRef,
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
export function createGeneralActionLifecycle(store: GeneralActionLifecycleStore) {
  /**
   * Loads an action the acting user may touch, or throws. It first tries an
   * owner-scoped read (the common private case), then falls back to a scope-visible
   * read so a household member can act on a shared or household action they can see
   * (ADR 0153). A not-found and a not-visible are indistinguishable on purpose —
   * fail closed, never confirm an action the caller may not see exists.
   */
  async function requireAction(input: GeneralActionActionInput): Promise<GeneralAction> {
    const action =
      (await store.getGeneralAction(input)) ??
      (await store.getVisibleGeneralAction({
        callerUserId: input.ownerUserId,
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
    const action = await store.getGeneralAction(input);
    if (!action) {
      throw new Error("Action not found.");
    }
    return action;
  }

  /**
   * Resolves an Area assignment for an Action, keeping the one-primary-Area rule
   * owner-safe. A non-null `areaId` must name an Area the owner owns and has not
   * archived — you cannot file an Action under someone else's Area or a retired one.
   * `null` clears the Area; `undefined` is never passed here (callers omit instead).
   */
  async function resolveAreaId(ownerUserId: string, areaId: string | null): Promise<string | null> {
    if (areaId === null) {
      return null;
    }

    const area = await store.getArea({ ownerUserId, areaId });
    if (!area) {
      throw new GeneralActionValidationError("That area no longer exists.");
    }
    assertAreaNotArchived(area);

    return area.id;
  }

  /**
   * Validates and normalizes a visibility choice, fail-closed. Private clears the
   * household; a household or shared scope requires the owner's active household, and
   * a shared scope additionally requires at least one selected active member. Widening
   * is always explicit — an absent scope stays private (ADR 0153).
   */
  async function resolveVisibility(input: {
    ownerUserId: string;
    scope?: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  }): Promise<{ scope: PrivacyScope; householdId: string | null }> {
    const scope = input.scope ?? "private";

    if (scope === "private") {
      return { scope, householdId: null };
    }

    // Non-private from here: `householdId` is a concrete string in every branch below,
    // so no cast is needed downstream.
    const householdId = input.householdId ?? null;
    if (!householdId) {
      throw new GeneralActionValidationError("Sharing an action needs a household.");
    }
    const membership = await store.getHouseholdMembership({
      householdId,
      userId: input.ownerUserId,
    });
    if (membership?.status !== "active") {
      throw new GeneralActionValidationError(
        "You must be an active member of that household to share an action.",
      );
    }

    if (scope === "shared") {
      const selected = input.selectedUserIds ?? [];
      if (selected.length === 0) {
        throw new GeneralActionValidationError(
          "Choose at least one person to share this action with.",
        );
      }
      const activeMembers = await store.listHouseholdMemberships({
        householdId,
        status: "active",
      });
      const activeIds = new Set(activeMembers.map((member) => member.userId));
      if (selected.some((userId) => !activeIds.has(userId))) {
        throw new GeneralActionValidationError(
          "Everyone you share an action with must be an active household member.",
        );
      }
    }

    return { scope, householdId };
  }

  /** Records a share row per selected member so a shared Action reaches exactly them. */
  async function writeShares(input: {
    householdId: string;
    actionId: string;
    ownerUserId: string;
    selectedUserIds: string[];
  }) {
    for (const sharedWithUserId of input.selectedUserIds) {
      await store.createHouseholdRecordShare({
        householdId: input.householdId,
        recordKind: "general_action",
        recordId: input.actionId,
        sharedWithUserId,
        sharedByUserId: input.ownerUserId,
      });
    }
  }

  /**
   * Verifies every person link is one the owner owns and returns the deduped set. A
   * link is context only — it never turns the Action into a Follow-Up (ADR 0155) —
   * but it must still be owner-scoped so an Action cannot point at a stranger's
   * person record.
   */
  async function verifyOwnedPeople(ownerUserId: string, personIds: string[]): Promise<string[]> {
    const unique = [...new Set(personIds)];
    for (const personId of unique) {
      const person = await store.getPerson({ ownerUserId, personId });
      if (!person) {
        throw new GeneralActionValidationError("You can only link your own people to an action.");
      }
    }
    return unique;
  }

  /**
   * Hydrates an action with its linked people (resolved owner-scoped and named for
   * display) and the audience detail behind its scope — how many members a `shared`
   * action reaches, and the household's name for a `shared`/`household` one — so the
   * surface can say *who* can see it, not just that it is shared. A viewing member
   * sees the names the owner chose to attach, not raw ids or other owner-scoped
   * fields (ADRs 0153, 0155).
   */
  async function hydrate(action: GeneralAction): Promise<GeneralActionWithContext> {
    const personIds = await store.listGeneralActionPersonIds({
      ownerUserId: action.ownerUserId,
      generalActionId: action.id,
    });
    const linkedPeople: GeneralActionPersonRef[] = [];
    for (const personId of personIds) {
      const person = await store.getPerson({ ownerUserId: action.ownerUserId, personId });
      if (person) {
        linkedPeople.push({ id: person.id, displayName: person.displayName });
      }
    }

    let sharedWithCount = 0;
    let householdName: string | null = null;
    if (action.scope !== "private" && action.householdId) {
      const household = await store.getHouseholdWorkspace({ householdId: action.householdId });
      householdName = household?.name ?? null;
      if (action.scope === "shared") {
        const shares = await store.listHouseholdRecordShares({
          householdId: action.householdId,
          recordKind: "general_action",
          recordId: action.id,
        });
        sharedWithCount = shares.length;
      }
    }

    return { ...action, linkedPeople, sharedWithCount, householdName };
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
      patch: { status, lastActorUserId: input.ownerUserId, ...patchExtra },
    });

    await recordEvent(updated, EVENT_KIND_FOR_ACTION[action], input.ownerUserId, {
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

      const areaId = await resolveAreaId(input.ownerUserId, input.areaId ?? null);
      const { scope, householdId } = await resolveVisibility(input);
      const personIds = input.personIds
        ? await verifyOwnedPeople(input.ownerUserId, input.personIds)
        : [];
      const assetHints = input.assetHints ?? [];

      const action = await store.createGeneralAction({
        ownerUserId: input.ownerUserId,
        title: input.title,
        notes: input.notes ?? null,
        links: input.links ?? [],
        assetHints,
        status: "open",
        dueAt: input.dueAt ?? null,
        deferUntil: null,
        recurrence: input.recurrence ?? null,
        sourceRecordId,
        areaId,
        scope,
        householdId,
        createdByUserId: input.ownerUserId,
        lastActorUserId: input.ownerUserId,
        completedAt: null,
      });

      if (personIds.length > 0) {
        await store.setGeneralActionPeople({
          ownerUserId: input.ownerUserId,
          generalActionId: action.id,
          personIds,
        });
      }
      if (scope === "shared" && householdId) {
        await writeShares({
          householdId,
          actionId: action.id,
          ownerUserId: input.ownerUserId,
          selectedUserIds: input.selectedUserIds ?? [],
        });
      }

      await recordEvent(action, "created", input.ownerUserId, {
        scope: action.scope,
        status: action.status,
        grounded: sourceRecordId !== null,
        filed: areaId !== null,
        peopleLinked: personIds.length,
        assetHints: assetHints.length,
        // Whether this is a Routine (recurring) or a one-time Action (ADR 0148).
        recurring: action.recurrence !== null,
      });

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
      if (
        edit.title === undefined &&
        edit.notes === undefined &&
        edit.dueAt === undefined &&
        edit.links === undefined &&
        edit.areaId === undefined &&
        edit.assetHints === undefined &&
        edit.recurrence === undefined
      ) {
        throw new GeneralActionValidationError(
          "An action edit must change the title, notes, due date, cadence, links, area, or asset hints.",
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
      if (edit.assetHints !== undefined) {
        patch.assetHints = edit.assetHints;
      }
      if (edit.recurrence !== undefined) {
        // A paused Routine can't have its cadence removed in place — that would leave
        // a paused one-time Action (ADR 0148). Resume first.
        assertRecurrenceEditAllowed(action.status, edit.recurrence);
        patch.recurrence = edit.recurrence;
      }
      if (edit.areaId !== undefined) {
        patch.areaId = await resolveAreaId(action.ownerUserId, edit.areaId);
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
        editedAssetHints: edit.assetHints !== undefined,
        editedArea: edit.areaId !== undefined,
        editedRecurrence: edit.recurrence !== undefined,
      });

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
      const { scope, householdId } = await resolveVisibility({
        ownerUserId: input.ownerUserId,
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
        patch: { scope, householdId, lastActorUserId: input.ownerUserId },
      });

      if (scope === "shared" && householdId) {
        await writeShares({
          householdId,
          actionId: action.id,
          ownerUserId: input.ownerUserId,
          selectedUserIds: input.selectedUserIds ?? [],
        });
      }

      await recordEvent(updated, "edited", input.ownerUserId, {
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
      const personIds = await verifyOwnedPeople(input.ownerUserId, input.personIds);

      await store.setGeneralActionPeople({
        ownerUserId: input.ownerUserId,
        generalActionId: action.id,
        personIds,
      });
      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: { lastActorUserId: input.ownerUserId },
      });

      await recordEvent(updated, "edited", input.ownerUserId, {
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
          lastActorUserId: input.ownerUserId,
        },
      });
      await recordEvent(updated, "completed", input.ownerUserId, {
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
        { ownerUserId: input.ownerUserId, generalActionId: input.generalActionId },
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
        (await store.getGeneralAction(input)) ??
        (await store.getVisibleGeneralAction({
          callerUserId: input.ownerUserId,
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
