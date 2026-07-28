import { archiveSavedItemAction, reopenSavedItemAction } from "@/app/actions/saved-items";
import type { ReversibleMutationAdapter } from "@/lib/reversible-mutation";
import type { SavedItemView } from "@/lib/saved-item-view";

type SavedItemLifecycleIntent = "archive" | "reopen";

export function savedItemLifecycleAdapter(
  intent: SavedItemLifecycleIntent,
): ReversibleMutationAdapter<SavedItemView> {
  return {
    // The module-owned leaving state is the projection so Undo remains on the
    // initiating row until the authoritative destination is applied.
    project: (prior) => prior,
    inverse: (prior) =>
      intent === "archive"
        ? reopenSavedItemAction({ savedItemId: prior.id })
        : archiveSavedItemAction({ savedItemId: prior.id }),
  };
}
