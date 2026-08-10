import {
  ACTIVE_GENERAL_ACTION_STATUSES,
  assertGeneralActionEditable,
  assertGeneralActionOperationForm,
  assertHouseholdNativeFilingAllowed,
  assertPausableRoutine,
  assertRecurrenceEditAllowed,
  assertResponsibilityHolder,
  assertResurfaceDate,
  type GeneralAction,
  type GeneralActionAuthorityOperation,
  type GeneralActionEventKind,
  type GeneralActionLifecycleAction,
  type GeneralActionStatus,
  GeneralActionValidationError,
  generalActionEditSchema,
  HouseholdRecordUnavailableError,
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
import { createGeneralActionAuthority } from "./household-authority";
import { hydrateGeneralAction } from "./hydrate";
import type {
  CreateActiveGeneralActionInput,
  DeferGeneralActionInput,
  EditGeneralActionInput,
  GeneralActionActionInput,
  GeneralActionLifecycleDeps,
  GeneralActionLifecycleStore,
  GeneralActionPatch,
  GeneralActionProgressInput,
  GeneralActionProgressOutcome,
  GeneralActionWithContext,
  HandGeneralActionToHouseholdInput,
  ListGeneralActionsInput,
  SetGeneralActionPeopleInput,
  SetGeneralActionVisibilityInput,
  SetResponsibilityHolderInput,
  UndoRoutineOccurrenceInput,
} from "./types";

const ACTIVE_STATUSES = [...ACTIVE_GENERAL_ACTION_STATUSES] as GeneralActionStatus[];

/** Maps a lifecycle action to the history event kind it records. */
const EVENT_KIND_FOR_ACTION: Record<GeneralActionLifecycleAction, GeneralActionEventKind> = {
  complete: "completed",
  defer: "deferred",
  undefer: "reopened",
  dismiss: "dismissed",
  reopen: "reopened",
  restore: "reopened",
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

  const { requireGeneralActionAuthority } = createGeneralActionAuthority(store);

  /**
   * Loads the row the acting user is talking about, whichever form it takes.
   *
   * The owner-keyed read runs first because it is the common private case and
   * because it is the only path that can reach a review-gated proposal. It is
   * accepted **only for a member-owned row**: a household-native record's
   * `ownerUserId` is a storage key, and honouring it as an access path would
   * leave the creating member reading and acting on the household's chores after
   * they had left — the one thing workspace ownership exists to prevent
   * (ADR 0214). Household-native rows therefore always come through the
   * scope-visible read, which requires current active membership.
   *
   * A not-found and a not-visible are indistinguishable on purpose.
   */
  async function loadAction(input: GeneralActionActionInput): Promise<GeneralAction> {
    const owned = await store.getGeneralAction({
      ownerUserId: input.actorUserId,
      generalActionId: input.generalActionId,
    });
    const action =
      owned?.ownership === "member_owned"
        ? owned
        : await store.getVisibleGeneralAction({
            callerUserId: input.actorUserId,
            generalActionId: input.generalActionId,
          });

    // The same sentence a refused proof produces. "No such action", "you may
    // not", and "you were removed from that household" have to be
    // indistinguishable from outside, because the difference between them is
    // exactly the protected fact (ADR 0219).
    if (!action) {
      throw new HouseholdRecordUnavailableError();
    }

    return action;
  }

  /**
   * Loads the action and proves the operation about to happen against it.
   *
   * Every mutating path goes through here with the operation it is really
   * performing, rather than through a `requireOwnedAction`-style read that bakes
   * "owner only" into which query runs. That is the whole shape of the Phase
   * Eight authority table: the same operation is owner-only on a member-owned
   * record and symmetric on a household-native one, and only the proof — reading
   * ownership form, current membership, and the current audience — can tell
   * which (ADR 0219).
   */
  async function requireAction(
    input: GeneralActionActionInput,
    operation: GeneralActionAuthorityOperation,
  ): Promise<GeneralAction> {
    const action = await loadAction(input);
    await requireGeneralActionAuthority({
      actorUserId: input.actorUserId,
      action,
      operation,
    });
    return action;
  }

  /**
   * The most recent settled progress on a record, and who settled it.
   *
   * Read from the existing lifecycle history rather than a denormalized column,
   * because history is already the authoritative record of who did what and a
   * second copy could disagree with it. Returns null when nothing has settled,
   * which is what a first completion looks like.
   */
  async function lastProgress(action: GeneralAction) {
    const events = await store.listGeneralActionEvents({
      ownerUserId: action.ownerUserId,
      generalActionId: action.id,
    });
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event && (event.kind === "completed" || event.kind === "skipped")) {
        return {
          handledAs: event.kind,
          handledByUserId: event.actorUserId,
          handledByName: null,
          handledAt: event.createdAt,
        } as const;
      }
    }
    return null;
  }

  /**
   * Validates a Responsibility Holder against the household's roster read now.
   *
   * The roster is the household's, not the caller's memberships, because the
   * question is about the person being named rather than the person naming them
   * — and a name is only meaningful while that member is still here (ADR 0215).
   */
  async function resolveResponsibilityHolder(input: {
    ownership: GeneralAction["ownership"];
    householdId: string | null;
    holderUserId: string | null;
  }): Promise<string | null> {
    if (input.holderUserId === null && input.ownership === "member_owned") {
      // Nothing named on a record that cannot carry a name: the ordinary
      // member-owned case, which must not trip the form guard below.
      return null;
    }
    const roster = input.householdId
      ? await store.listHouseholdMemberships({
          householdId: input.householdId,
          status: "active",
        })
      : [];
    return assertResponsibilityHolder({
      ownership: input.ownership,
      holderUserId: input.holderUserId,
      activeMemberUserIds: roster.map((membership) => membership.userId),
    });
  }

  /**
   * Settles a progress action that arrived after someone else's.
   *
   * It returns authoritative state and an account of what happened to the
   * occurrence — never an error, and never a second advance. Arriving second is
   * not a failure, and the member's tap was a truthful report that simply lost
   * the race.
   */
  async function reconcileProgress(action: GeneralAction): Promise<GeneralActionProgressOutcome> {
    const current =
      (await store.getGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
      })) ?? action;
    const settled = await lastProgress(current);
    return {
      ...(await hydrate(current)),
      reconciliation: settled
        ? {
            handledAs: settled.handledAs,
            handledByUserId: settled.handledByUserId,
            handledByName: null,
            handledAt: settled.handledAt,
          }
        : null,
    };
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
    operation: GeneralActionAuthorityOperation,
    patchExtra: GeneralActionPatch = {},
    detail: Record<string, unknown> = {},
    preloaded?: GeneralAction,
  ) {
    const current = preloaded ?? (await requireAction(input, operation));
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

  /**
   * Advances a Routine's one authoritative occurrence, fenced.
   *
   * A household-native Routine has exactly one current occurrence for the whole
   * household — no per-member occurrences, no per-member completion state — so
   * two members completing bin day must advance it once. The conditional write
   * is what guarantees that: it moves the occurrence only while the fence still
   * reads what the acting member saw, and a member who lost the race is
   * reconciled against the outcome instead of rolling the chore forward a second
   * week.
   *
   * The fence is skipped when the caller named no expectation, which is the
   * private single-owner case and every programmatic caller acting on current
   * state. Even then the transition guard below still refuses to advance an
   * already-settled record, so nothing can double-advance silently.
   */
  async function advanceRoutineOccurrence(
    input: GeneralActionProgressInput,
    kind: "completed" | "skipped",
    preloaded?: GeneralAction,
  ): Promise<GeneralActionProgressOutcome> {
    const current =
      preloaded ?? (await requireAction(input, kind === "skipped" ? "skip" : "progress"));
    if (!current.recurrence) {
      throw new GeneralActionValidationError("Only a Routine occurrence can be skipped.");
    }
    if (
      input.expectedOccurrenceVersion !== undefined &&
      input.expectedOccurrenceVersion !== current.occurrenceVersion
    ) {
      return reconcileProgress(current);
    }
    resolveGeneralActionTransition(current.status, "complete");
    const advancedAt = new Date();
    const nextDueAt = nextRoutineDueAt(current.recurrence, advancedAt);
    const updated = await store.advanceGeneralActionOccurrence({
      ownerUserId: current.ownerUserId,
      generalActionId: current.id,
      expectedOccurrenceVersion: current.occurrenceVersion,
      patch: {
        status: "open",
        dueAt: nextDueAt,
        deferUntil: null,
        completedAt: null,
        lastActorUserId: input.actorUserId,
      },
    });
    // The fence moved between the read and the write: another member advanced
    // this occurrence in the gap, which is exactly the race the counter exists
    // to catch. Settle on their outcome and say so.
    if (!updated) {
      return reconcileProgress(current);
    }
    await recordEvent(updated, kind, input.actorUserId, {
      previousStatus: current.status,
      status: updated.status,
      rolledForward: true,
      occurrenceAdvancedAt: advancedAt.toISOString(),
      previousDueAt: current.dueAt ? current.dueAt.toISOString() : null,
      nextDueAt: nextDueAt.toISOString(),
      occurrenceVersion: updated.occurrenceVersion,
    });
    return { ...(await hydrate(updated)), reconciliation: null };
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
      const ownership = input.ownership ?? "member_owned";
      assertHouseholdNativeFilingAllowed({ ownership, areaId: input.areaId });
      const sourceRecordId = await resolveSourceRecordId(
        store,
        input.ownerUserId,
        input.sourceRecordId,
      );
      const areaId = await resolveAreaId(store, input.ownerUserId, input.areaId ?? null);
      // A household-native record is visible to every active member by
      // definition, so its scope is not a choice the caller gets to make
      // differently — the audience *is* the household (ADR 0214). Routing it
      // through the same guard still buys the check that matters: the creator's
      // own active membership in the household they are writing into.
      const { scope, householdId } = await resolveVisibility(store, {
        ...input,
        ...(ownership === "household_native" ? { scope: "household" as const } : {}),
      });
      if (input.personIds?.length) {
        assertGeneralActionOperationForm({ operation: "people", ownership });
      }
      const personIds = input.personIds
        ? await verifyOwnedPeople(store, input.ownerUserId, input.personIds)
        : [];
      const responsibilityHolderUserId = await resolveResponsibilityHolder({
        ownership,
        householdId,
        holderUserId: input.responsibilityHolderUserId ?? null,
      });
      const assetHints = input.assetHints ?? [];

      const actionValues = buildCreateGeneralActionValues(input, {
        status: "open",
        sourceRecordId,
        areaId,
        scope,
        householdId,
        ownership,
        responsibilityHolderUserId,
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
            ownership,
            status: actionValues.status,
            grounded: sourceRecordId !== null,
            filed: areaId !== null,
            peopleLinked: personIds.length,
            assetHints: assetHints.length,
            // Whether this is a Routine (recurring) or a one-time Action (ADR 0148).
            recurring: actionValues.recurrence !== null,
            responsibilityHolderNamed: responsibilityHolderUserId !== null,
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
     * rejected.
     *
     * Authority depends on the ownership form, and only the proof knows which.
     * A member-owned Action stays its owner's to author however wide its audience
     * gets — a member who can see it may *act* on it but never rewrite it — while
     * a household-native one is every active member's to edit, because the
     * household's chore is not anybody's to hold (ADRs 0153, 0214).
     */
    async editGeneralAction(input: EditGeneralActionInput) {
      const action = await requireAction(input, "edit");

      assertGeneralActionEditable(action.status);
      const edit = generalActionEditSchema.parse(input.edit);
      assertHouseholdNativeFilingAllowed({
        ownership: action.ownership,
        areaId: edit.areaId,
      });

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
      const action = await requireAction(input, "audience");
      const { scope, householdId } = await resolveVisibility(store, {
        // The `audience` proof grants only the owner of a member-owned record,
        // and refuses household-native outright, so the actor is the owner here
        // and resolving against them finds the right household.
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
          // The `audience` proof already established the actor is the owner.
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
      const action = await requireAction(input, "people");
      assertGeneralActionEditable(action.status);
      const personIds = await verifyOwnedPeople(store, input.actorUserId, input.personIds);

      await store.setGeneralActionPeople({
        // The `people` operation is refused outright on a household-native record
        // and owner-only otherwise, so the actor owns both the action and the
        // people being linked.
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
     * trail is preserved without any streak or scoring (ADRs 0147, 0165).
     *
     * Anyone who can see the Action may complete it, whichever form it takes:
     * "I picked up the milk" is a truthful, reversible report about someone
     * else's errand, and the household's chore is everyone's to finish. Racing
     * taps reconcile rather than double-advance — see
     * {@link GeneralActionProgressOutcome}.
     */
    async completeGeneralAction(
      input: GeneralActionProgressInput,
    ): Promise<GeneralActionProgressOutcome> {
      const current = await requireAction(input, "progress");
      if (current.recurrence !== null) {
        return advanceRoutineOccurrence(input, "completed", current);
      }

      // A one-time Action has no occurrence to roll forward, so its race shows
      // up as a second member finding it already settled. It is reconciled on
      // exactly the same terms rather than surfacing as an invalid-transition
      // error, and it takes the same conditional write, so the history carries
      // one completion rather than two.
      if (
        !ACTIVE_GENERAL_ACTION_STATUSES.has(current.status) ||
        (input.expectedOccurrenceVersion !== undefined &&
          input.expectedOccurrenceVersion !== current.occurrenceVersion)
      ) {
        return reconcileProgress(current);
      }
      const completed = await store.advanceGeneralActionOccurrence({
        ownerUserId: current.ownerUserId,
        generalActionId: current.id,
        expectedOccurrenceVersion: current.occurrenceVersion,
        patch: {
          status: resolveGeneralActionTransition(current.status, "complete"),
          completedAt: new Date(),
          deferUntil: null,
          lastActorUserId: input.actorUserId,
        },
      });
      if (!completed) {
        return reconcileProgress(current);
      }
      await recordEvent(completed, "completed", input.actorUserId, {
        previousStatus: current.status,
        status: completed.status,
        occurrenceVersion: completed.occurrenceVersion,
      });
      return { ...(await hydrate(completed)), reconciliation: null };
    },

    skipGeneralActionOccurrence(
      input: GeneralActionProgressInput,
    ): Promise<GeneralActionProgressOutcome> {
      return advanceRoutineOccurrence(input, "skipped");
    },

    /**
     * Reverses one just-advanced Routine occurrence for any actor who could perform
     * it. The expected next due date makes a stale Undo fail visibly rather than
     * rewinding a later occurrence.
     */
    async undoRoutineOccurrence(input: UndoRoutineOccurrenceInput) {
      const current = await requireAction(input, "progress");
      if (!current.recurrence) {
        throw new GeneralActionValidationError("Only a Routine occurrence can be restored.");
      }
      if (current.dueAt?.getTime() !== input.expectedDueAt.getTime()) {
        throw new GeneralActionValidationError(
          "This Routine changed before Undo could be applied.",
        );
      }
      const updated = await store.updateGeneralAction({
        ownerUserId: current.ownerUserId,
        generalActionId: current.id,
        patch: { dueAt: input.restoreDueAt, lastActorUserId: input.actorUserId },
      });
      await recordEvent(updated, "reopened", input.actorUserId, {
        previousDueAt: current.dueAt.toISOString(),
        restoredDueAt: input.restoreDueAt.toISOString(),
        rolledBack: true,
      });
      return hydrate(updated);
    },

    /**
     * Dismisses an Action. Grouped with archive rather than with completion:
     * "I archived your errand" was never the audience's decision to take, so on
     * a member-owned record it returns to the owner while completion stays open
     * to everyone who can see it.
     */
    dismissGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "dismiss", "archive", { deferUntil: null });
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
      const current = await requireAction(input, "edit");
      assertPausableRoutine(current);
      return transition(input, "pause", "edit", { deferUntil: null }, {}, current);
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
      const current = await requireAction(input, "edit");
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
      return transition(input, "resume", "edit", patch, detail, current);
    },

    reopenGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "reopen", "progress", { completedAt: null, deferUntil: null });
    },

    restoreGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "restore", "archive", { completedAt: null, deferUntil: null });
    },

    archiveGeneralAction(input: GeneralActionActionInput) {
      // Clear the resurface date on the way out, like the other terminal
      // transitions — an archived action never resurfaces.
      return transition(input, "archive", "archive", { deferUntil: null });
    },

    /** Defers an active Action to a concrete resurface date so it comes back later. */
    async deferGeneralAction(input: DeferGeneralActionInput) {
      const deferUntil = assertResurfaceDate(input.deferUntil);
      return transition(
        { actorUserId: input.actorUserId, generalActionId: input.generalActionId },
        "defer",
        "defer",
        { deferUntil },
        { deferUntil: deferUntil.toISOString() },
      );
    },

    /** Clears a deliberate set-aside as the authoritative inverse of deferral. */
    undeferGeneralAction(input: GeneralActionActionInput) {
      return transition(input, "undefer", "defer", { deferUntil: null });
    },

    /**
     * Names, changes, or clears who is looking after a household-native record.
     *
     * Any active member may set it, including naming someone other than
     * themselves, because it is the household's statement about its own
     * arrangement rather than a claim on a person. It changes nobody's
     * authority and starts no alert: being named offers that member their own
     * Reminder Schedule and waits for their answer, which is the only shape a
     * reminder about someone else's device is allowed to take (ADR 0203).
     *
     * `handedOff` distinguishes the one-tap hand-off offered at completion from
     * an ordinary edit. It is a difference in the story history tells, not in
     * what is written, because a stored sequence is exactly what ADR 0215
     * refuses: an alternating chore stays seamless through repeated explicit
     * hand-offs, and a settled one is named once and never touched again.
     */
    async setResponsibilityHolder(input: SetResponsibilityHolderInput) {
      const action = await requireAction(input, "responsibility");
      const holderUserId = await resolveResponsibilityHolder({
        ownership: action.ownership,
        householdId: action.householdId,
        holderUserId: input.holderUserId,
      });
      const previousHolderUserId = action.responsibilityHolderUserId;

      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: {
          responsibilityHolderUserId: holderUserId,
          lastActorUserId: input.actorUserId,
        },
      });

      await recordEvent(updated, "responsibility_changed", input.actorUserId, {
        previousHolderUserId,
        holderUserId,
        handedOff: input.handedOff === true,
        // Whether the outgoing member's own reminder went with the hand-off.
        // Recorded because it is a change to that member's device, and only ever
        // true when they were the one acting.
        removedOwnReminder:
          input.removeOutgoingReminder === true && previousHolderUserId === input.actorUserId,
      });

      return hydrate(updated);
    },

    /**
     * Hands a member-owned record over to the household, in place and for good.
     *
     * This is the explicit, confirmed conversion — not a re-scope. Widening an
     * Action to household visibility says "you can see this"; this says "this is
     * ours now": every active member may edit and archive it, and it stays with
     * the household if the member who wrote it leaves. Its creator provenance
     * and its whole history come with it, unrewritten.
     *
     * There is no way back. Reversing it would mean choosing which member wins a
     * record the workspace owns, and a member who wants a private version
     * archives this one and writes their own (ADR 0214).
     */
    async handGeneralActionToHousehold(input: HandGeneralActionToHouseholdInput) {
      // Proved as an audience change, which is the closest thing the record is
      // doing and the only operation reserved to the owner *and* refused
      // outright on a record that is already the household's.
      const action = await requireAction(input, "audience");
      // A private record has no household on it yet, so the actor's own active
      // membership supplies one. Read from their memberships rather than taken
      // as an argument, so no caller can hand a record to a household they are
      // not in.
      const [membership] = action.householdId
        ? []
        : await store.listActiveHouseholdMembershipsForUser({ userId: input.actorUserId });
      const { householdId } = await resolveVisibility(store, {
        ownerUserId: input.actorUserId,
        scope: "household",
        householdId: action.householdId ?? membership?.householdId ?? null,
      });

      // A record that reached the household through selected-member sharing
      // carries share rows that now say less than the household scope does.
      if (action.householdId) {
        await store.deleteHouseholdRecordShares({
          householdId: action.householdId,
          recordKind: "general_action",
          recordId: action.id,
        });
      }

      const holderUserId = await resolveResponsibilityHolder({
        ownership: "household_native",
        householdId,
        holderUserId: input.responsibilityHolderUserId ?? null,
      });

      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: {
          ownership: "household_native",
          scope: "household",
          householdId,
          responsibilityHolderUserId: holderUserId,
          // An Area is one member's private filing and cannot follow a record
          // into the household's ownership.
          areaId: null,
          lastActorUserId: input.actorUserId,
        },
      });
      // People links are personal too, and unfilable by anyone else once the
      // record is the household's.
      await store.setGeneralActionPeople({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        personIds: [],
      });

      await recordEvent(updated, "handed_to_household", input.actorUserId, {
        previousScope: action.scope,
        householdId,
        responsibilityHolderNamed: holderUserId !== null,
      });

      return hydrate(updated);
    },

    /**
     * The household's own Actions and Routines. The read behind the Household
     * home (#384) and the departure and dissolution sweeps, which hold a
     * household rather than a member. Callers still prove each record they act
     * on — this is a listing, not an authorization.
     */
    listGeneralActionsForHousehold(input: {
      householdId: string;
      ownership?: GeneralAction["ownership"];
      statuses?: GeneralActionStatus[];
    }) {
      return store.listGeneralActionsForHousehold(input);
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
      return hydrate(await requireAction(input, "view"));
    },

    /**
     * The append-only lifecycle history for one Action, oldest first. Visible-scoped
     * and fail-closed: an action the caller cannot see (a stranger's, or another
     * household's) returns an empty history rather than leaking that it exists — the
     * caller simply sees nothing (ADR 0153). A visible member reads history keyed on
     * the record's true owner.
     */
    async listGeneralActionHistory(input: GeneralActionActionInput) {
      // Loaded through the same gate as everything else — in particular, a
      // household-native record is never reached through its storage key, so a
      // departed creator cannot read the household's trail — and then returned
      // as an empty history rather than a refusal, because a caller who cannot
      // see the record must not learn from this call that it exists.
      const action = await loadAction(input).catch(() => null);
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
