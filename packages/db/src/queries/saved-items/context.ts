import type { SavedItem } from "@tendnote/domain";
import type { SavedItemLifecycleStore, SavedItemWithContext } from "./types";

export async function hydrateSavedItem(
  store: SavedItemLifecycleStore,
  item: SavedItem,
): Promise<SavedItemWithContext> {
  const shares =
    item.scope === "shared" && item.householdId
      ? await store.listHouseholdRecordShares({
          householdId: item.householdId,
          recordKind: "saved_item",
          recordId: item.id,
        })
      : [];
  const household =
    item.scope !== "private" && item.householdId
      ? await store.getHouseholdWorkspace({ householdId: item.householdId })
      : null;
  return {
    ...item,
    sharedWithUserIds: shares.map((share) => share.sharedWithUserId),
    householdName: household?.name ?? null,
    outcomes: await store.listSavedItemOutcomes({ savedItemId: item.id }),
  };
}

export async function requireOwnedSavedItem(
  store: SavedItemLifecycleStore,
  input: { actorUserId: string; savedItemId: string },
) {
  const item = await store.getSavedItem({
    ownerUserId: input.actorUserId,
    savedItemId: input.savedItemId,
  });
  if (!item) throw new Error("Saved Item not found.");
  return item;
}
