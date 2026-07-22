import type { SavedItemLifecycleStore } from "./types";

export async function withRejectedSavedItemAudit<T>(
  store: SavedItemLifecycleStore,
  input: { actorUserId: string; savedItemId: string },
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const item = await store.getSavedItem({
      ownerUserId: input.actorUserId,
      savedItemId: input.savedItemId,
    });
    if (item) {
      try {
        await store.createSavedItemEvent({
          savedItemId: item.id,
          ownerUserId: item.ownerUserId,
          kind: "mutation_rejected",
          actorUserId: input.actorUserId,
          detailJson: {
            operation,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        });
      } catch {
        // Audit failure must not replace the original product error.
      }
    }
    throw error;
  }
}
