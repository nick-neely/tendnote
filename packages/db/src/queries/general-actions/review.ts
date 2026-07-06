import {
  canUseSensitiveContext,
  type GeneralAction,
  generalActionEditSchema,
} from "@tendnote/domain";
import {
  buildGeneralActionEditPatch,
  isEmptyGeneralActionEdit,
  resolveAreaId,
  resolveVisibility,
  verifyOwnedPeople,
  writeShares,
} from "./attach";
import { hydrateGeneralAction } from "./hydrate";
import type {
  AcceptSuggestedGeneralActionInput,
  EditSuggestedGeneralActionInput,
  GeneralActionActionInput,
  GeneralActionLifecycleStore,
  GeneralActionPatch,
  ListSuggestedGeneralActionReviewsInput,
  SuggestedGeneralActionReviewResult,
  SuggestGeneralActionInput,
} from "./types";

/**
 * Review-gated Suggested General Action lifecycle (ADRs 0144, 0151, 0152). A Suggested
 * General Action is a `general_actions` row persisted with status `suggested`: it stays
 * out of the active Actions ledger and every proactive surface until the user accepts
 * it, which promotes it *in place* to `open` — a durable Action, or a Routine when it
 * carries a cadence. This reuses the shared review-queue model the app already runs for
 * suggested memories and follow-ups (ADR 0152): a proposal is one authoritative record,
 * every mutation is owner-scoped and written to the action's own lifecycle history, and
 * acceptance flips a status rather than copying a row — so promotion is inherently
 * idempotent (there is only ever one action) and the suggested and active paths never
 * fork. Extraction (#183) and Eve (#186) feed this by calling `suggestGeneralAction`.
 */
export function createSuggestedGeneralActionReview(store: GeneralActionLifecycleStore) {
  async function buildReviewResult(
    action: GeneralAction,
  ): Promise<SuggestedGeneralActionReviewResult> {
    // Grounding is resolved owner-scoped so review surfaces show where the proposal
    // came from; a record from another owner can never leak in (ADR 0151).
    const [hydrated, sourceRecord] = await Promise.all([
      hydrateGeneralAction(store, action),
      action.sourceRecordId
        ? store.getSourceRecord({
            ownerUserId: action.ownerUserId,
            sourceRecordId: action.sourceRecordId,
          })
        : Promise.resolve(null),
    ]);

    return {
      action: hydrated,
      sourceRecord,
      component: {
        type: "suggested_general_action_review",
        generalActionId: action.id,
        sourceRecordId: action.sourceRecordId ?? null,
      },
    };
  }

  /** Loads an owner-scoped action and asserts it is still an actionable proposal. */
  async function requireSuggested(input: GeneralActionActionInput): Promise<GeneralAction> {
    const action = await store.getGeneralAction(input);
    if (!action) {
      throw new Error("Suggested action not found.");
    }
    if (action.status !== "suggested") {
      throw new Error("Only suggested actions can be reviewed.");
    }
    return action;
  }

  return {
    /**
     * Proposes a Suggested General Action: a `suggested` row grounded in an owner-scoped
     * source record, carrying editable metadata (timing, recurrence, Area, people links,
     * asset hints) and a coarse visibility scope. It never becomes an active Action until
     * accepted. Grounding is mandatory (ADR 0151), and restricted context is not used for
     * a proactive proposal unless the user asked directly (ADR 0058).
     */
    async suggestGeneralAction(
      input: SuggestGeneralActionInput,
    ): Promise<SuggestedGeneralActionReviewResult> {
      const sourceRecord = await store.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      });
      if (!sourceRecord) {
        throw new Error("A suggested action must be grounded in a source record.");
      }
      if (
        !canUseSensitiveContext({
          sensitivity: sourceRecord.sensitivity,
          directlyRequested: input.directlyRequested,
        })
      ) {
        throw new Error(
          "Restricted context isn't used for proactive action suggestions unless you ask directly.",
        );
      }

      const areaId = await resolveAreaId(store, input.ownerUserId, input.areaId ?? null);
      // A proposal argues for private or household visibility only; a finer
      // selected-shared audience is chosen at acceptance, so no shares are written for a
      // still-suggested row (it never reaches a member's surfaces regardless).
      const { scope, householdId } = await resolveVisibility(store, {
        ownerUserId: input.ownerUserId,
        scope: input.scope,
        householdId: input.householdId,
      });
      const personIds = input.personIds
        ? await verifyOwnedPeople(store, input.ownerUserId, input.personIds)
        : [];

      const action = await store.createGeneralAction({
        ownerUserId: input.ownerUserId,
        title: input.title,
        notes: input.notes ?? null,
        links: input.links ?? [],
        assetHints: input.assetHints ?? [],
        status: "suggested",
        dueAt: input.dueAt ?? null,
        deferUntil: input.deferUntil ?? null,
        recurrence: input.recurrence ?? null,
        sourceRecordId: sourceRecord.id,
        areaId,
        scope,
        householdId,
        // Creator provenance: who proposed it. The accepting user is stamped as actor
        // on promotion, so accepted-by provenance is preserved without losing the
        // proposer (ADR 0154).
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

      await store.createGeneralActionEvent({
        generalActionId: action.id,
        ownerUserId: action.ownerUserId,
        kind: "suggested",
        actorUserId: input.ownerUserId,
        detailJson: {
          scope: action.scope,
          grounded: true,
          filed: areaId !== null,
          peopleLinked: personIds.length,
          recurring: action.recurrence !== null,
        },
      });

      return buildReviewResult(action);
    },

    async listSuggestedGeneralActionReviews(
      input: ListSuggestedGeneralActionReviewsInput,
    ): Promise<SuggestedGeneralActionReviewResult[]> {
      const suggested = await store.listGeneralActionsForOwner({
        ownerUserId: input.ownerUserId,
        statuses: ["suggested"],
        limit: input.limit,
      });
      return Promise.all(suggested.map((action) => buildReviewResult(action)));
    },

    async getSuggestedGeneralActionReview(
      input: GeneralActionActionInput,
    ): Promise<SuggestedGeneralActionReviewResult | null> {
      const action = await store.getGeneralAction(input);
      if (action?.status !== "suggested") {
        return null;
      }
      return buildReviewResult(action);
    },

    /**
     * Accepts a Suggested General Action, promoting it in place to a durable `open`
     * Action (a Routine when it carries a cadence). An optional edit corrects content
     * first; an optional scope finalizes the audience, including a selected-shared one a
     * bare proposal could not carry, writing the member shares only now.
     *
     * Idempotent (ADRs 0151, 0152): promotion flips a status on a single row, so a retry
     * finds the action no longer `suggested` and returns it unchanged — it can never
     * create a second Action. An `ignored` proposal is not silently promoted; the caller
     * must re-propose. This mirrors the load-check-then-act idempotency the shared review
     * queue uses.
     *
     * Two callers racing to accept the same proposal is benign: both converge on the same
     * `open` Action (the idempotent target, keyed by id), so no duplicate Action is ever
     * created. The only possible artifact is a second `promoted` history row, which is
     * harmless — history is an append-only trail with no analytics (ADR 0165). A conditional
     * write is not worth the extra round-trip for a duplicate note in a single owner's own
     * review, and every write stays owner-scoped.
     */
    async acceptSuggestedGeneralAction(
      input: AcceptSuggestedGeneralActionInput,
    ): Promise<SuggestedGeneralActionReviewResult> {
      const existing = await store.getGeneralAction(input);
      if (!existing) {
        throw new Error("Suggested action not found.");
      }
      if (existing.status === "ignored") {
        throw new Error("This suggestion was set aside; propose it again to act on it.");
      }
      if (existing.status !== "suggested") {
        // Already promoted (or otherwise resolved): a no-op that returns the durable
        // action, so accepting the same proposal twice never creates a duplicate.
        return buildReviewResult(existing);
      }

      const edit = generalActionEditSchema.parse(input.edit ?? {});
      const patch: GeneralActionPatch = {
        status: "open",
        lastActorUserId: input.ownerUserId,
        ...(await buildGeneralActionEditPatch(store, existing.ownerUserId, edit)),
      };

      // Finalize visibility only when the accept explicitly chooses a scope; otherwise
      // keep the proposal's scope. Re-running the shared visibility guard lets a reviewer
      // widen a proposal to a selected-shared audience the proposal itself couldn't hold.
      let sharesToWrite: { householdId: string; selectedUserIds: string[] } | null = null;
      if (input.scope !== undefined) {
        const { scope, householdId } = await resolveVisibility(store, {
          ownerUserId: input.ownerUserId,
          scope: input.scope,
          householdId: input.householdId,
          selectedUserIds: input.selectedUserIds,
        });
        patch.scope = scope;
        patch.householdId = householdId;
        if (scope === "shared" && householdId) {
          sharesToWrite = { householdId, selectedUserIds: input.selectedUserIds ?? [] };
        }
      }

      const updated = await store.updateGeneralAction({
        ownerUserId: existing.ownerUserId,
        generalActionId: existing.id,
        patch,
      });

      if (sharesToWrite) {
        await writeShares(store, {
          householdId: sharesToWrite.householdId,
          actionId: updated.id,
          ownerUserId: input.ownerUserId,
          selectedUserIds: sharesToWrite.selectedUserIds,
        });
      }

      // A `promoted` event marks the durable action as born from a proposal, preserving
      // grounding and accepted-by provenance in history without productivity analytics.
      await store.createGeneralActionEvent({
        generalActionId: updated.id,
        ownerUserId: updated.ownerUserId,
        kind: "promoted",
        actorUserId: input.ownerUserId,
        detailJson: {
          previousStatus: existing.status,
          status: updated.status,
          fromSuggestion: true,
          sourceRecordId: updated.sourceRecordId ?? null,
          edited: Object.keys(edit).length > 0,
          recurring: updated.recurrence !== null,
        },
      });

      return buildReviewResult(updated);
    },

    /** Corrects a Suggested General Action's content in place, leaving it `suggested`. */
    async editSuggestedGeneralAction(
      input: EditSuggestedGeneralActionInput,
    ): Promise<SuggestedGeneralActionReviewResult> {
      const action = await requireSuggested(input);
      const edit = generalActionEditSchema.parse(input.edit);

      if (isEmptyGeneralActionEdit(edit)) {
        throw new Error(
          "A review edit must change the title, notes, timing, cadence, links, area, or asset hints.",
        );
      }

      const patch: GeneralActionPatch = {
        lastActorUserId: input.ownerUserId,
        ...(await buildGeneralActionEditPatch(store, action.ownerUserId, edit)),
      };

      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch,
      });

      await store.createGeneralActionEvent({
        generalActionId: updated.id,
        ownerUserId: updated.ownerUserId,
        kind: "edited",
        actorUserId: input.ownerUserId,
        detailJson: {
          reviewEdit: true,
          editedTitle: edit.title !== undefined,
          editedNotes: edit.notes !== undefined,
          editedDueAt: edit.dueAt !== undefined,
          editedLinks: edit.links !== undefined,
          editedAssetHints: edit.assetHints !== undefined,
          editedArea: edit.areaId !== undefined,
          editedRecurrence: edit.recurrence !== undefined,
        },
      });

      return buildReviewResult(updated);
    },

    /**
     * Dismisses a Suggested General Action — the user rejects the proposal. It moves to
     * the shared `dismissed` terminal (a rejected proposal and a dismissed action share
     * the same meaning) and leaves review. Because `dismissed` is a normal resolved state,
     * a dismissed proposal stays in the resolved trail and is reopenable there: reopening
     * it (`dismissed → open` via the shared lifecycle) is a deliberate late-acceptance
     * recovery path, and its `reopened` history event records that the durable Action came
     * from a change of mind about a rejected proposal. This is why `dismissed` is the
     * *softer*, recoverable outcome — unlike `ignored`, which clears the proposal from the
     * ledgers entirely.
     */
    async dismissSuggestedGeneralAction(input: GeneralActionActionInput): Promise<GeneralAction> {
      const action = await requireSuggested(input);
      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: { status: "dismissed", lastActorUserId: input.ownerUserId },
      });
      await store.createGeneralActionEvent({
        generalActionId: updated.id,
        ownerUserId: updated.ownerUserId,
        kind: "dismissed",
        actorUserId: input.ownerUserId,
        detailJson: { previousStatus: action.status, status: updated.status, fromSuggestion: true },
      });
      return updated;
    },

    /**
     * Ignores a Suggested General Action — the quiet set-aside for a proposal the user
     * doesn't want to act on now and doesn't want cluttering the resolved trail. It moves
     * to `ignored`, which never surfaces on the active *or* resolved ledger, so the
     * proposal simply disappears from view. `ignored` has no in-place transition out (it is
     * terminal in the lifecycle matrix), so it is more final in place than a dismissal —
     * but it is not lost forever: a later extraction or Eve turn can re-propose the same
     * thing as a fresh suggestion. It is the calmer choice precisely because it leaves no
     * resolved-trail residue, not because it is easier to undo.
     */
    async ignoreSuggestedGeneralAction(input: GeneralActionActionInput): Promise<GeneralAction> {
      const action = await requireSuggested(input);
      const updated = await store.updateGeneralAction({
        ownerUserId: action.ownerUserId,
        generalActionId: action.id,
        patch: { status: "ignored", lastActorUserId: input.ownerUserId },
      });
      await store.createGeneralActionEvent({
        generalActionId: updated.id,
        ownerUserId: updated.ownerUserId,
        kind: "ignored",
        actorUserId: input.ownerUserId,
        detailJson: { previousStatus: action.status, status: updated.status },
      });
      return updated;
    },
  };
}
