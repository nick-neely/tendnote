import { requireOwnedSavedItem } from "./context";
import type { SavedItemLifecycleStore } from "./types";

export async function getSourceDeletionImpact(
  store: SavedItemLifecycleStore,
  input: { actorUserId: string; sourceRecordId: string },
) {
  const source = await store.getSourceRecord({
    ownerUserId: input.actorUserId,
    sourceRecordId: input.sourceRecordId,
  });
  if (!source) throw new Error("Source record not found.");
  const linkedItems = await store.listSavedItemsBySourceRecord({
    ownerUserId: input.actorUserId,
    sourceRecordId: source.id,
  });
  const linkedOutcomes = (
    await Promise.all(
      linkedItems.map((item) => store.listSavedItemOutcomes({ savedItemId: item.id })),
    )
  ).flat();
  const linkedRecords = await store.listSourceRecordDependencies({
    ownerUserId: input.actorUserId,
    sourceRecordId: source.id,
  });
  return {
    sourceRecordId: source.id,
    linkedSavedItemIds: linkedItems.map((item) => item.id),
    linkedOutcomes: linkedOutcomes.map((outcome) => ({
      destinationKind: outcome.destinationKind,
      destinationRecordId: outcome.destinationRecordId,
    })),
    linkedRecords,
    requiresImpactDisclosure:
      linkedItems.length > 1 ||
      linkedOutcomes.length > 0 ||
      linkedRecords.length > 0 ||
      source.scope !== "private",
  };
}

export async function deleteUniqueSavedItemSource(
  store: SavedItemLifecycleStore,
  input: { actorUserId: string; savedItemId: string },
) {
  const item = await requireOwnedSavedItem(store, input);
  const impact = await getSourceDeletionImpact(store, {
    actorUserId: input.actorUserId,
    sourceRecordId: item.sourceRecordId,
  });
  if (impact.requiresImpactDisclosure) {
    throw new Error("This source is shared or reused. Review its impact before deleting evidence.");
  }
  await store.deleteUniqueSavedItemSourceEvidence({
    ownerUserId: input.actorUserId,
    sourceRecordId: item.sourceRecordId,
    savedItemId: item.id,
  });
  return { deletedSavedItemId: item.id, deletedSourceRecordId: item.sourceRecordId };
}
