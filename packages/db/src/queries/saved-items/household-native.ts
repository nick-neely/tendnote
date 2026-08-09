import { randomUUID } from "node:crypto";
import {
  assertSavedItemEditable,
  assertSavedItemVersion,
  createSourceRecordSchema,
  HouseholdRecordUnavailableError,
  isEmptySavedItemEdit,
  resolveSavedItemTransition,
  type SavedItem,
  SavedItemConflictError,
  type SavedItemEdit,
  SavedItemValidationError,
  savedItemConflict,
  savedItemEditSchema,
  savedItemResolutionReasonSchema,
} from "@tendnote/domain";
import type { AffectedScope } from "../affected-scopes";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { hydrateSavedItem } from "./context";
import { stablePromotionDestinationId } from "./promotion";
import type {
  CreateHouseholdSavedItemInput,
  HouseholdSavedItemMutationInput,
  SavedItemLifecycleDeps,
  SavedItemLifecycleStore,
  SavedItemPatch,
  SavedItemWithContext,
} from "./types";

/**
 * The Saved Item household collaboration boundary.
 *
 * Everything a member does to a **household-native** Saved Item goes through
 * here, and nothing here ever asks who owns the record, what role the caller
 * holds, or whether they created it. Authority comes from one place — the
 * Household Authorization Proof, re-read from storage on every call — because
 * the whole point of a workspace-owned record is that every active member has
 * the same standing over it and nobody accumulates more (ADR 0214, ADR 0219).
 *
 * It is deliberately separate from the owner-scoped lifecycle next door rather
 * than an ownership flag threaded through it. The member-owned path is keyed by
 * `ownerUserId` in its store calls and that is exactly right for what it does:
 * widening a member's Saved Item to the household must not widen who may edit,
 * archive, resolve, promote, or delete its evidence. Two paths that cannot be
 * confused is the guarantee; one path with a branch would be a place to forget
 * the branch (see `docs/phase-8/household-saved-items.md`).
 *
 * Three things this boundary is not. It is not a conversion path: a member-owned
 * Saved Item never becomes household-native, and a household-native one never
 * becomes anyone's. It is not a deletion path: archive is how a workspace-owned
 * record leaves, so no member can take the household's history with them. And it
 * is not an inbox, checklist, or thread — the operations below are exactly the
 * Saved Item lifecycle that already existed, with the ownership form changed.
 */
export function createHouseholdSavedItemCollaboration(
  store: SavedItemLifecycleStore,
  deps: SavedItemLifecycleDeps = {},
) {
  const prover = createHouseholdAuthorizationProver(store);

  /**
   * Reads the record, then proves the caller against what was actually stored.
   *
   * Read-then-prove in this order, never the reverse: the facts the proof needs
   * — ownership form, scope, household — are the record's, and a caller who
   * supplied them could assert standing they do not have. A record that is
   * missing, or that turns out to be member-owned, refuses identically to one
   * the caller may not touch, so nothing here reveals which it was.
   */
  async function provenItem(input: {
    actorUserId: string;
    savedItemId: string;
    operation: "view" | "update" | "archive";
  }): Promise<SavedItem> {
    const item = await store.getSavedItemById({ savedItemId: input.savedItemId });
    if (item?.ownership !== "household_native") {
      throw new HouseholdRecordUnavailableError();
    }
    await prover.requireRecordAccess({
      callerUserId: input.actorUserId,
      operation: input.operation,
      record: {
        kind: "saved_item",
        id: item.id,
        ownerUserId: item.ownerUserId,
        scope: item.scope,
        householdId: item.householdId,
        ownership: item.ownership,
      },
    });
    return item;
  }

  /**
   * Applies a proven write under its version, or hands the member back the
   * current value.
   *
   * The conflict is raised from the row read *after* the failed write rather
   * than the one read before it, so the value shown beside the kept draft is the
   * one that actually won — not a third state that existed only in between.
   */
  async function write(input: {
    item: SavedItem;
    expectedVersion?: number;
    patch: SavedItemPatch;
  }): Promise<SavedItem> {
    assertSavedItemVersion(input.item, input.expectedVersion);
    const updated = await store.updateHouseholdNativeSavedItem({
      savedItemId: input.item.id,
      expectedVersion: input.item.version,
      patch: input.patch,
    });
    if (updated) return updated;

    const current = await store.getSavedItemById({ savedItemId: input.item.id });
    if (current?.ownership !== "household_native") {
      throw new HouseholdRecordUnavailableError();
    }
    throw new SavedItemConflictError(savedItemConflict(current));
  }

  async function record(
    item: SavedItem,
    kind: Parameters<SavedItemLifecycleStore["createSavedItemEvent"]>[0]["kind"],
    actorUserId: string,
    detailJson: Record<string, unknown>,
    eventId?: string,
  ) {
    await store.createSavedItemEvent({
      id: eventId,
      savedItemId: item.id,
      // Null, matching the record: a household-native trail has no owner, and
      // `actorUserId` is what attribution was ever about.
      ownerUserId: null,
      kind,
      actorUserId,
      detailJson: { ...detailJson, ownership: "household_native", version: item.version },
    });
  }

  /**
   * The grounding a household-native item stands on.
   *
   * A supplied Source Record has to already be household-visible in this same
   * household. Anything else would take one member's private evidence and show
   * it to everyone as a side effect of a Saved Item write, which is the one
   * thing evidence sharing must always be a deliberate act of. A capture with no
   * source of its own gets a fresh household-scoped one.
   */
  async function resolveHouseholdSource(input: CreateHouseholdSavedItemInput): Promise<string> {
    if (input.sourceRecordId) {
      const source = await store.getSourceRecord({
        ownerUserId: input.actorUserId,
        sourceRecordId: input.sourceRecordId,
      });
      if (!source) throw new SavedItemValidationError("Source record not found.");
      if (source.scope !== "household" || source.householdId !== input.householdId) {
        throw new SavedItemValidationError(
          "A household Saved Item needs evidence the whole household can already see.",
        );
      }
      return source.id;
    }
    const source = await store.createSourceRecord(
      createSourceRecordSchema.parse({
        ownerUserId: input.actorUserId,
        sourceType: "manual",
        content: input.originalText ?? input.content ?? input.title,
        rawContent: null,
        retentionPolicy: "retain",
        status: "active",
        confidence: "high",
        sensitivity: "normal",
        scope: "household",
        householdId: input.householdId,
        importance: 3,
        metadataJson: { captureSurface: "saved_items", householdNative: true },
      }),
    );
    return source.id;
  }

  async function hydrated(item: SavedItem): Promise<SavedItemWithContext> {
    return hydrateSavedItem(store, item);
  }

  async function transition(
    input: HouseholdSavedItemMutationInput & { action: "archive" | "reopen" },
  ): Promise<SavedItemWithContext> {
    // `archive` is the proof operation for leaving the active set; restoring one
    // is an ordinary content-authority write. Both resolve to the same standing
    // for a household-native record, and asking the accurate question keeps the
    // audit trail honest about what was attempted.
    const item = await provenItem({
      actorUserId: input.actorUserId,
      savedItemId: input.savedItemId,
      operation: input.action === "archive" ? "archive" : "update",
    });
    const status = resolveSavedItemTransition(item.status, input.action, {
      kind: item.kind,
      resolved: item.resolvedAt !== null,
    });
    const updated = await write({
      item,
      expectedVersion: input.expectedVersion,
      patch: { status, lastActorUserId: input.actorUserId },
    });
    await record(updated, input.action === "archive" ? "archived" : "reopened", input.actorUserId, {
      previousStatus: item.status,
      status,
    });
    return hydrated(updated);
  }

  return {
    /**
     * Writes a new Saved Item that the Household Workspace owns.
     *
     * The record's id is minted before the proof so the grant names the actual
     * record rather than a placeholder, and the proof is asked the write
     * question — may this caller author a workspace-owned record in this
     * household — instead of a membership lookup this module would then have to
     * interpret itself.
     */
    async createHouseholdSavedItem(
      input: CreateHouseholdSavedItemInput,
    ): Promise<SavedItemWithContext> {
      const id = input.id ?? randomUUID();
      await prover.requireRecordAccess({
        callerUserId: input.actorUserId,
        operation: "update",
        record: {
          kind: "saved_item",
          id,
          ownerUserId: null,
          scope: "household",
          householdId: input.householdId,
          ownership: "household_native",
        },
      });

      const sourceRecordId = await resolveHouseholdSource(input);
      const item = await store.createSavedItem({
        id,
        ownerUserId: null,
        ownership: "household_native",
        kind: input.kind,
        title: input.title,
        content: input.content ?? null,
        url: input.url ?? null,
        bringBackAt: input.bringBackAt ?? null,
        bringBackTimeSemantics: input.bringBackTimeSemantics ?? "date_only",
        sourceRecordId,
        scope: "household",
        householdId: input.householdId,
        createdByUserId: input.actorUserId,
        lastActorUserId: input.actorUserId,
      });
      await record(
        item,
        "created",
        input.actorUserId,
        { kind: item.kind, scope: item.scope, grounded: true },
        input.createdEventId,
      );
      return hydrated(item);
    },

    /** Reads one household-native item, refusing opaquely when it is not the caller's to see. */
    async getHouseholdSavedItem(input: {
      actorUserId: string;
      savedItemId: string;
    }): Promise<SavedItemWithContext> {
      return hydrated(await provenItem({ ...input, operation: "view" }));
    },

    async editHouseholdSavedItem(
      input: HouseholdSavedItemMutationInput & { edit: SavedItemEdit },
    ): Promise<SavedItemWithContext> {
      const item = await provenItem({
        actorUserId: input.actorUserId,
        savedItemId: input.savedItemId,
        operation: "update",
      });
      assertSavedItemEditable(item);
      const edit = savedItemEditSchema.parse(input.edit);
      if (isEmptySavedItemEdit(edit)) {
        throw new SavedItemValidationError(
          "A Saved Item edit must change its content or bring-back time.",
        );
      }
      const updated = await write({
        item,
        expectedVersion: input.expectedVersion,
        patch: { ...edit, lastActorUserId: input.actorUserId },
      });
      await record(updated, "edited", input.actorUserId, {
        editedTitle: edit.title !== undefined,
        editedContent: edit.content !== undefined,
        editedUrl: edit.url !== undefined,
        editedBringBackAt: edit.bringBackAt !== undefined,
      });
      return hydrated(updated);
    },

    archiveHouseholdSavedItem(input: HouseholdSavedItemMutationInput) {
      return transition({ ...input, action: "archive" });
    },

    restoreHouseholdSavedItem(input: HouseholdSavedItemMutationInput) {
      return transition({ ...input, action: "reopen" });
    },

    async resolveHouseholdSavedItem(
      input: HouseholdSavedItemMutationInput & { reason: string },
    ): Promise<SavedItemWithContext> {
      const item = await provenItem({
        actorUserId: input.actorUserId,
        savedItemId: input.savedItemId,
        operation: "archive",
      });
      const reason = savedItemResolutionReasonSchema.parse(input.reason);
      const status = resolveSavedItemTransition(item.status, "resolve", { kind: item.kind });
      const updated = await write({
        item,
        expectedVersion: input.expectedVersion,
        patch: {
          status,
          resolvedAt: new Date(),
          resolutionReason: reason,
          lastActorUserId: input.actorUserId,
        },
      });
      await record(updated, "resolved", input.actorUserId, {
        previousStatus: item.status,
        status,
      });
      return hydrated(updated);
    },

    /**
     * Promotes a household-native Saved Item into a household-native Action.
     *
     * There is no destination choice here. A workspace-owned Saved Item can only
     * become a workspace-owned Action: letting the member who pressed promote
     * end up owning the result would transfer the household's record to them,
     * which is precisely the implicit transfer the two ownership forms exist to
     * prevent.
     */
    async promoteHouseholdSavedItem(
      input: HouseholdSavedItemMutationInput & { idempotencyKey: string; title?: string },
    ): Promise<{
      savedItem: SavedItemWithContext;
      affectedGeneralActionScopes: readonly AffectedScope[];
    }> {
      const item = await provenItem({
        actorUserId: input.actorUserId,
        savedItemId: input.savedItemId,
        operation: "update",
      });
      const idempotencyKey = input.idempotencyKey.trim();
      if (!idempotencyKey) {
        throw new SavedItemValidationError("A promotion needs an idempotency key.");
      }

      const existing = (await store.listSavedItemOutcomes({ savedItemId: item.id })).find(
        (outcome) => outcome.idempotencyKey === idempotencyKey,
      );
      if (existing) {
        return {
          savedItem: await completePromotion(item, input, existing, true),
          affectedGeneralActionScopes: [],
        };
      }

      assertSavedItemEditable(item);
      if (!deps.createHouseholdNativeGeneralAction) {
        throw new SavedItemValidationError(
          "Household Actions aren't available yet, so this can stay here for now.",
        );
      }
      if (!item.householdId) throw new HouseholdRecordUnavailableError();

      const action = await deps.createHouseholdNativeGeneralAction({
        id: stablePromotionDestinationId(idempotencyKey),
        householdId: item.householdId,
        createdByUserId: input.actorUserId,
        title: input.title?.trim() || item.title,
        notes: item.content ?? item.url,
        sourceRecordId: item.sourceRecordId,
      });
      const outcome = await store.createSavedItemOutcome({
        savedItemId: item.id,
        destinationKind: "general_action",
        destinationRecordId: action.result.id,
        idempotencyKey,
      });
      return {
        savedItem: await completePromotion(item, input, outcome, false),
        affectedGeneralActionScopes: action.affectedScopes,
      };
    },
  };

  /**
   * Archives the promoted item as resolved and records the promotion once.
   *
   * Split from the destination write so a retry that finds an existing outcome
   * lands in exactly the same terminal state as the first attempt: promotion is
   * idempotent, and an item already archived by an earlier try is left alone
   * rather than re-stamped with a second resolution time.
   */
  async function completePromotion(
    item: SavedItem,
    input: HouseholdSavedItemMutationInput & { idempotencyKey: string },
    destination: { destinationKind: "general_action"; destinationRecordId: string },
    resumed: boolean,
  ): Promise<SavedItemWithContext> {
    const completed =
      item.status === "archived"
        ? item
        : await write({
            item,
            expectedVersion: input.expectedVersion,
            patch: {
              status: "archived",
              resolvedAt: new Date(),
              resolutionReason: "Promoted to a household Action.",
              lastActorUserId: input.actorUserId,
            },
          });

    const priorEvents = await store.listSavedItemEvents({
      ownerUserId: null,
      savedItemId: completed.id,
    });
    const alreadyAudited = priorEvents.some(
      (event) =>
        event.kind === "promoted" && event.detailJson.idempotencyKey === input.idempotencyKey,
    );
    if (!alreadyAudited) {
      await record(completed, "promoted", input.actorUserId, {
        ...destination,
        idempotencyKey: input.idempotencyKey,
        resumed,
      });
    }
    return hydrateSavedItem(store, completed);
  }
}
