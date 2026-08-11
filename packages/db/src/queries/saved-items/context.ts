import type { MemberOwnedSavedItem, SavedItem } from "@tendnote/domain";
import type { SavedItemContext, SavedItemLifecycleStore } from "./types";

/**
 * Generic in the item rather than fixed to `SavedItem`, so hydrating a
 * {@link MemberOwnedSavedItem} still yields one. Otherwise every owner-scoped
 * path would forget it has an owner the moment it added context.
 */
export async function hydrateSavedItem<TItem extends SavedItem>(
  store: SavedItemLifecycleStore,
  item: TItem,
): Promise<TItem & SavedItemContext> {
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

export type { MemberOwnedSavedItem };

/**
 * The owner-scoped read every member-owned lifecycle operation starts from.
 *
 * The lookup is keyed by owner, so a household-native record - which has no
 * owner - is simply not found here. That is the seam keeping the two ownership
 * forms apart: this path cannot be talked into touching a workspace-owned Saved
 * Item, whatever the caller passes (ADR 0214).
 */
export async function requireOwnedSavedItem(
  store: SavedItemLifecycleStore,
  input: { actorUserId: string; savedItemId: string },
): Promise<MemberOwnedSavedItem> {
  const item = await store.getSavedItem({
    ownerUserId: input.actorUserId,
    savedItemId: input.savedItemId,
  });
  if (!item) throw new Error("Saved Item not found.");
  return item;
}
