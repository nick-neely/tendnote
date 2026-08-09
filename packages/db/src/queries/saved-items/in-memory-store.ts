import { randomUUID } from "node:crypto";
import {
  canViewScopedRecord,
  createSavedItemSchema,
  type SavedItem,
  type SavedItemEvent,
  type SavedItemOutcome,
  savedItemSchema,
} from "@tendnote/domain";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { SavedItemLifecycleStore } from "./types";

export type InMemorySavedItemLifecycleStore = SavedItemLifecycleStore &
  ReturnType<typeof createInMemorySourceRecordStore> &
  ReturnType<typeof createInMemoryHouseholdStore>;

export function createInMemorySavedItemRecordStore() {
  const records = new Map<string, SavedItem>();
  return {
    records,
    async createSavedItem(input: Parameters<SavedItemLifecycleStore["createSavedItem"]>[0]) {
      const values = createSavedItemSchema.parse(input);
      const now = new Date();
      const item = savedItemSchema.parse({
        ...values,
        id: values.id ?? randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      const existing = records.get(item.id);
      if (existing) return existing;
      records.set(item.id, item);
      return item;
    },
    async getSavedItem(input: { ownerUserId: string; savedItemId: string }) {
      const item = records.get(input.savedItemId);
      return item?.ownerUserId === input.ownerUserId
        ? { ...item, ownerUserId: input.ownerUserId }
        : null;
    },
    async getSavedItemById(input: { savedItemId: string }) {
      return records.get(input.savedItemId) ?? null;
    },
    async updateSavedItem(input: Parameters<SavedItemLifecycleStore["updateSavedItem"]>[0]) {
      const current = records.get(input.savedItemId);
      if (!current || current.ownerUserId !== input.ownerUserId) {
        throw new Error("Saved Item not found.");
      }
      const updated = savedItemSchema.parse({
        ...current,
        ...input.patch,
        version: current.version + 1,
        updatedAt: new Date(),
      });
      records.set(updated.id, updated);
      return { ...updated, ownerUserId: input.ownerUserId };
    },
    async updateHouseholdNativeSavedItem(
      input: Parameters<SavedItemLifecycleStore["updateHouseholdNativeSavedItem"]>[0],
    ) {
      const current = records.get(input.savedItemId);
      if (current?.ownership !== "household_native" || current.version !== input.expectedVersion) {
        return null;
      }
      const updated = savedItemSchema.parse({
        ...current,
        ...input.patch,
        version: current.version + 1,
        updatedAt: new Date(),
      });
      records.set(updated.id, updated);
      return updated;
    },
  };
}

export function createInMemorySavedItemLifecycleStore(): InMemorySavedItemLifecycleStore {
  const sourceStore = createInMemorySourceRecordStore();
  const householdStore = createInMemoryHouseholdStore();
  const recordStore = createInMemorySavedItemRecordStore();
  const items = recordStore.records;
  const events: SavedItemEvent[] = [];
  const outcomes: SavedItemOutcome[] = [];
  const deletedSourceRecordIds = new Set<string>();

  async function isVisible(callerUserId: string, item: SavedItem): Promise<boolean> {
    const memberships = await householdStore.listActiveHouseholdMembershipsForUser({
      userId: callerUserId,
    });
    const shares = item.householdId
      ? await householdStore.listHouseholdRecordShares({
          householdId: item.householdId,
          recordKind: "saved_item",
          recordId: item.id,
        })
      : [];
    return canViewScopedRecord({
      callerUserId,
      record: {
        ownerUserId: item.ownerUserId,
        scope: item.scope,
        householdId: item.householdId,
        sharedWithUserIds: shares.map((share) => share.sharedWithUserId),
      },
      activeMemberships: memberships.map((membership) => ({
        householdId: membership.householdId,
        userId: membership.userId,
      })),
    });
  }

  return {
    ...sourceStore,
    ...householdStore,
    ...recordStore,
    createSourceRecordAuditLogEntry: sourceStore.createAuditLogEntry,
    async listAuditLogEntries(input: { ownerUserId: string }) {
      return sourceStore.listAuditLogEntries(input);
    },
    async getSourceRecord(input) {
      if (deletedSourceRecordIds.has(input.sourceRecordId)) return null;
      return sourceStore.getSourceRecord(input);
    },
    async getVisibleSavedItem(input) {
      const item = items.get(input.savedItemId);
      return item && (await isVisible(input.callerUserId, item)) ? item : null;
    },
    async listVisibleSavedItems(input) {
      const visible: SavedItem[] = [];
      for (const item of items.values()) {
        if (
          (input.statuses === undefined || input.statuses.includes(item.status)) &&
          (input.scopes === undefined || input.scopes.includes(item.scope)) &&
          (await isVisible(input.callerUserId, item))
        ) {
          visible.push(item);
        }
      }
      visible.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return input.limit === undefined ? visible : visible.slice(0, input.limit);
    },
    async listSavedItemsBySourceRecord(input) {
      return [...items.values()].filter(
        (item) =>
          item.ownerUserId === input.ownerUserId && item.sourceRecordId === input.sourceRecordId,
      );
    },
    async listSourceRecordDependencies() {
      return [];
    },
    async searchVisibleSavedItems(input) {
      const query = input.query.toLocaleLowerCase();
      const matches: SavedItem[] = [];
      for (const item of items.values()) {
        const searchable = [item.title, item.content, item.url]
          .filter((value): value is string => Boolean(value))
          .join(" ")
          .toLocaleLowerCase();
        if (
          (item.status === "active" || input.includeArchived === true) &&
          searchable.includes(query) &&
          (await isVisible(input.callerUserId, item))
        ) {
          matches.push(item);
        }
      }
      matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return matches.slice(0, input.limit ?? 20);
    },
    async createSavedItemEvent(input) {
      const event: SavedItemEvent = {
        ...input,
        detailJson: input.detailJson ?? {},
        id: input.id ?? randomUUID(),
        createdAt: new Date(),
      };
      const existing = events.find((candidate) => candidate.id === event.id);
      if (existing) return existing;
      events.push(event);
      return event;
    },
    async listSavedItemEvents(input) {
      return events.filter(
        (event) =>
          event.ownerUserId === input.ownerUserId && event.savedItemId === input.savedItemId,
      );
    },
    async createSavedItemOutcome(input) {
      const existing = outcomes.find((outcome) => outcome.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const outcome = { ...input, id: randomUUID(), createdAt: new Date() };
      outcomes.push(outcome);
      return outcome;
    },
    async listSavedItemOutcomes(input) {
      return outcomes.filter((outcome) => outcome.savedItemId === input.savedItemId);
    },
    async deleteUniqueSavedItemSourceEvidence(input) {
      const item = items.get(input.savedItemId);
      if (
        !item ||
        item.ownerUserId !== input.ownerUserId ||
        item.sourceRecordId !== input.sourceRecordId
      ) {
        throw new Error("Saved Item source evidence not found.");
      }
      const dependencies = await this.listSourceRecordDependencies(input);
      const linkedItems = [...items.values()].filter(
        (candidate) =>
          candidate.ownerUserId === input.ownerUserId &&
          candidate.sourceRecordId === input.sourceRecordId,
      );
      const linkedOutcomes = outcomes.filter((outcome) => outcome.savedItemId === item.id);
      const source = await sourceStore.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      });
      if (
        source?.scope !== "private" ||
        linkedItems.length !== 1 ||
        linkedOutcomes.length > 0 ||
        dependencies.length > 0
      ) {
        throw new Error(
          "This source is shared or reused. Review its impact before deleting evidence.",
        );
      }
      items.delete(item.id);
      deletedSourceRecordIds.add(input.sourceRecordId);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.savedItemId === item.id) events.splice(index, 1);
      }
      for (let index = outcomes.length - 1; index >= 0; index -= 1) {
        if (outcomes[index]?.savedItemId === item.id) outcomes.splice(index, 1);
      }
      await sourceStore.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "saved_item.source_evidence_deleted",
        entityType: "saved_item_source",
        entityId: item.id,
        metadataJson: { sourceRecordId: input.sourceRecordId },
      });
    },
  };
}
