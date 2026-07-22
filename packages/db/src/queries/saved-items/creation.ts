import {
  createSavedItemSchema,
  createSourceRecordSchema,
  SavedItemValidationError,
} from "@tendnote/domain";
import { resolveRecordVisibility } from "../households/record-visibility";
import { hydrateSavedItem } from "./context";
import type { CreateSavedItemInput, SavedItemLifecycleStore } from "./types";

type SavedItemVisibility = {
  scope: "private" | "shared" | "household";
  householdId: string | null;
};

async function shareRecord(
  store: SavedItemLifecycleStore,
  input: CreateSavedItemInput,
  visibility: SavedItemVisibility,
  record: { kind: "source_record" | "saved_item"; id: string },
) {
  if (visibility.scope !== "shared" || !visibility.householdId) return;
  for (const sharedWithUserId of input.selectedUserIds ?? []) {
    await store.createHouseholdRecordShare({
      householdId: visibility.householdId,
      recordKind: record.kind,
      recordId: record.id,
      sharedWithUserId,
      sharedByUserId: input.ownerUserId,
    });
  }
}

async function resolveSource(
  store: SavedItemLifecycleStore,
  input: CreateSavedItemInput,
  visibility: SavedItemVisibility,
) {
  if (input.sourceRecordId) {
    const source = await store.getSourceRecord({
      ownerUserId: input.ownerUserId,
      sourceRecordId: input.sourceRecordId,
    });
    if (!source) throw new Error("Source record not found.");
    return source.id;
  }
  const source = await store.createSourceRecord(
    createSourceRecordSchema.parse({
      ownerUserId: input.ownerUserId,
      sourceType: "manual",
      content: input.originalText ?? input.content ?? input.title,
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "high",
      sensitivity: "normal",
      scope: visibility.scope,
      householdId: visibility.householdId,
      importance: 3,
      metadataJson: { captureSurface: "saved_items" },
    }),
  );
  await shareRecord(store, input, visibility, { kind: "source_record", id: source.id });
  return source.id;
}

export async function createGroundedSavedItem(
  store: SavedItemLifecycleStore,
  input: CreateSavedItemInput,
) {
  const visibility = await resolveRecordVisibility(store, input, {
    recordNoun: "Saved Item",
    recordNounWithArticle: "a Saved Item",
    fail: (message) => new SavedItemValidationError(message),
  });
  const sourceRecordId = await resolveSource(store, input, visibility);
  const item = await store.createSavedItem(
    createSavedItemSchema.parse({
      id: input.id,
      ownerUserId: input.ownerUserId,
      kind: input.kind,
      title: input.title,
      content: input.content ?? null,
      url: input.url ?? null,
      bringBackAt: input.bringBackAt ?? null,
      bringBackTimeSemantics: input.bringBackTimeSemantics ?? "date_only",
      sourceRecordId,
      ...visibility,
      createdByUserId: input.ownerUserId,
      lastActorUserId: input.ownerUserId,
    }),
  );
  await shareRecord(store, input, visibility, { kind: "saved_item", id: item.id });
  await store.createSavedItemEvent({
    id: input.createdEventId,
    savedItemId: item.id,
    ownerUserId: item.ownerUserId,
    kind: "created",
    actorUserId: input.ownerUserId,
    detailJson: { kind: item.kind, scope: item.scope, grounded: true },
  });
  return hydrateSavedItem(store, item);
}
