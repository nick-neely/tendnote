import {
  assertSavedItemEditable,
  isEmptySavedItemEdit,
  resolveSavedItemTransition,
  SavedItemValidationError,
  savedItemEditSchema,
  savedItemResolutionReasonSchema,
  savedItemSchema,
  savedItemSearchQuerySchema,
} from "@tendnote/domain";
import { withRejectedSavedItemAudit } from "./audit";
import { hydrateSavedItem, requireOwnedSavedItem } from "./context";
import { createGroundedSavedItem } from "./creation";
import { deleteUniqueSavedItemSource, getSourceDeletionImpact } from "./privacy-impact";
import { type PromoteSavedItemInput, promoteSavedItem } from "./promotion";
import type {
  CreateSavedItemInput,
  EditSavedItemInput,
  SavedItemLifecycleDeps,
  SavedItemLifecycleStore,
  SavedItemWithContext,
} from "./types";

export function createSavedItemLifecycle(
  store: SavedItemLifecycleStore,
  deps: SavedItemLifecycleDeps = {},
) {
  const scheduleEmbedding = deps.scheduleEmbedding ?? (async () => undefined);
  async function scheduleEmbeddingBestEffort(input: {
    ownerUserId: string;
    recordKind: "saved_item";
    recordId: string;
  }) {
    try {
      await scheduleEmbedding(input);
    } catch {
      // The durable write is authoritative. Semantic indexing can be retried later.
    }
  }
  async function requireOwnedItem(input: { actorUserId: string; savedItemId: string }) {
    return requireOwnedSavedItem(store, input);
  }

  async function transition(
    input: { actorUserId: string; savedItemId: string },
    action: "archive" | "reopen",
  ): Promise<SavedItemWithContext> {
    return withRejectedSavedItemAudit(store, input, action, async () => {
      const current = await requireOwnedItem(input);
      const status = resolveSavedItemTransition(current.status, action, {
        kind: current.kind,
        resolved: current.resolvedAt !== null,
      });
      const updated = await store.updateSavedItem({
        ownerUserId: current.ownerUserId,
        savedItemId: current.id,
        patch: { status, lastActorUserId: input.actorUserId },
      });
      await store.createSavedItemEvent({
        savedItemId: updated.id,
        ownerUserId: updated.ownerUserId,
        kind: action === "archive" ? "archived" : "reopened",
        actorUserId: input.actorUserId,
        detailJson: { previousStatus: current.status, status },
      });
      await scheduleEmbeddingBestEffort({
        ownerUserId: updated.ownerUserId,
        recordKind: "saved_item",
        recordId: updated.id,
      });
      return hydrateSavedItem(store, updated);
    });
  }

  return {
    async createSavedItem(input: CreateSavedItemInput): Promise<SavedItemWithContext> {
      const item = await createGroundedSavedItem(store, input);
      await scheduleEmbeddingBestEffort({
        ownerUserId: item.ownerUserId,
        recordKind: "saved_item",
        recordId: item.id,
      });
      return item;
    },
    async getSavedItem(input: { callerUserId: string; savedItemId: string }) {
      const item = await store.getVisibleSavedItem(input);
      return item ? hydrateSavedItem(store, item) : null;
    },
    async listSavedItems(input: {
      callerUserId: string;
      includeArchived?: boolean;
      limit?: number;
    }): Promise<SavedItemWithContext[]> {
      const items = await store.listVisibleSavedItems({
        callerUserId: input.callerUserId,
        statuses: input.includeArchived ? ["active", "archived"] : ["active"],
        limit: input.limit,
      });
      return Promise.all(items.map((item) => hydrateSavedItem(store, item)));
    },
    async editSavedItem(input: EditSavedItemInput): Promise<SavedItemWithContext> {
      return withRejectedSavedItemAudit(store, input, "edit", async () => {
        const current = await requireOwnedItem(input);
        assertSavedItemEditable(current);
        const edit = savedItemEditSchema.parse(input.edit);
        if (isEmptySavedItemEdit(edit)) {
          throw new SavedItemValidationError(
            "A Saved Item edit must change its content or bring-back time.",
          );
        }
        const patch = {
          ...edit,
          lastActorUserId: input.actorUserId,
        };
        savedItemSchema.parse({ ...current, ...patch, updatedAt: new Date() });
        const updated = await store.updateSavedItem({
          ownerUserId: current.ownerUserId,
          savedItemId: current.id,
          patch,
        });
        await store.createSavedItemEvent({
          savedItemId: updated.id,
          ownerUserId: updated.ownerUserId,
          kind: "edited",
          actorUserId: input.actorUserId,
          detailJson: {
            editedTitle: edit.title !== undefined,
            editedContent: edit.content !== undefined,
            editedUrl: edit.url !== undefined,
            editedBringBackAt: edit.bringBackAt !== undefined,
          },
        });
        await scheduleEmbeddingBestEffort({
          ownerUserId: updated.ownerUserId,
          recordKind: "saved_item",
          recordId: updated.id,
        });
        return hydrateSavedItem(store, updated);
      });
    },
    archiveSavedItem(input: { actorUserId: string; savedItemId: string }) {
      return transition(input, "archive");
    },
    reopenSavedItem(input: { actorUserId: string; savedItemId: string }) {
      return transition(input, "reopen");
    },
    async resolveSavedItem(input: {
      actorUserId: string;
      savedItemId: string;
      reason: string;
    }): Promise<SavedItemWithContext> {
      return withRejectedSavedItemAudit(store, input, "resolve", async () => {
        const current = await requireOwnedItem(input);
        const reason = savedItemResolutionReasonSchema.parse(input.reason);
        const status = resolveSavedItemTransition(current.status, "resolve", {
          kind: current.kind,
        });
        const resolvedAt = new Date();
        const updated = await store.updateSavedItem({
          ownerUserId: current.ownerUserId,
          savedItemId: current.id,
          patch: {
            status,
            resolvedAt,
            resolutionReason: reason,
            lastActorUserId: input.actorUserId,
          },
        });
        await store.createSavedItemEvent({
          savedItemId: updated.id,
          ownerUserId: updated.ownerUserId,
          kind: "resolved",
          actorUserId: input.actorUserId,
          detailJson: { previousStatus: current.status, status },
        });
        await scheduleEmbeddingBestEffort({
          ownerUserId: updated.ownerUserId,
          recordKind: "saved_item",
          recordId: updated.id,
        });
        return hydrateSavedItem(store, updated);
      });
    },
    async searchSavedItems(input: {
      callerUserId: string;
      query: string;
      includeArchived?: boolean;
      limit?: number;
    }): Promise<SavedItemWithContext[]> {
      const query = savedItemSearchQuerySchema.safeParse(input.query);
      if (!query.success) return [];
      const items = await store.searchVisibleSavedItems({ ...input, query: query.data });
      return Promise.all(items.map((item) => hydrateSavedItem(store, item)));
    },
    async promoteSavedItemToGeneralAction(input: PromoteSavedItemInput) {
      return withRejectedSavedItemAudit(store, input, "promote", async () => {
        const promotion = await promoteSavedItem(store, deps, input);
        const item = promotion.savedItem;
        await scheduleEmbeddingBestEffort({
          ownerUserId: item.ownerUserId,
          recordKind: "saved_item",
          recordId: item.id,
        });
        return promotion;
      });
    },
    getSourceDeletionImpact(input: { actorUserId: string; sourceRecordId: string }) {
      return getSourceDeletionImpact(store, input);
    },
    deleteUniqueSavedItemSource(input: { actorUserId: string; savedItemId: string }) {
      return withRejectedSavedItemAudit(store, input, "delete_source_evidence", () =>
        deleteUniqueSavedItemSource(store, input),
      );
    },
  };
}
