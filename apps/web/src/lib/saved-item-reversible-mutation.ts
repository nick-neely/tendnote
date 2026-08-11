import type { SavedItemOwnership } from "@tendnote/domain";
import {
  archiveHouseholdSavedItemAction,
  archiveSavedItemAction,
  reopenSavedItemAction,
  restoreHouseholdSavedItemAction,
} from "@/app/actions/saved-items";
import type { ReversibleMutationAdapter } from "@/lib/reversible-mutation";
import type { SavedItemView } from "@/lib/saved-item-view";

type SavedItemLifecycleIntent = "archive" | "reopen";

/**
 * The inverse for a reversible Saved Item lifecycle change, in whichever
 * ownership form the row is. Undo has to reach the same boundary the original
 * command did: an owner-keyed reopen cannot find a record with no owner.
 */
export function savedItemLifecycleAdapter(
  intent: SavedItemLifecycleIntent,
  ownership: SavedItemOwnership,
): ReversibleMutationAdapter<SavedItemView> {
  const undo =
    ownership === "household_native"
      ? intent === "archive"
        ? restoreHouseholdSavedItemAction
        : archiveHouseholdSavedItemAction
      : intent === "archive"
        ? reopenSavedItemAction
        : archiveSavedItemAction;
  return {
    // The module-owned leaving state is the projection so Undo remains on the
    // initiating row until the authoritative destination is applied.
    project: (prior) => prior,
    inverse: (prior) => undo({ savedItemId: prior.id }),
  };
}
