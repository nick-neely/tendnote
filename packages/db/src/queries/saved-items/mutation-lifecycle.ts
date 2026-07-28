import type { MutationOutcome } from "../affected-scopes";
import { affectedScopesForSavedItem } from "../assets/affected-scopes";
import type { createSavedItemLifecycle } from "./lifecycle";

type SavedItemLifecycle = ReturnType<typeof createSavedItemLifecycle>;

export function createAffectedSavedItemLifecycle(lifecycle: SavedItemLifecycle) {
  async function withScopes<TResult extends { id: string; ownerUserId: string }>(
    run: () => Promise<TResult>,
  ): Promise<MutationOutcome<TResult>> {
    const result = await run();
    return { result, affectedScopes: affectedScopesForSavedItem(result) };
  }

  return {
    ...lifecycle,
    createSavedItem(input: Parameters<SavedItemLifecycle["createSavedItem"]>[0]) {
      return withScopes(() => lifecycle.createSavedItem(input));
    },
    editSavedItem(input: Parameters<SavedItemLifecycle["editSavedItem"]>[0]) {
      return withScopes(() => lifecycle.editSavedItem(input));
    },
    archiveSavedItem(input: Parameters<SavedItemLifecycle["archiveSavedItem"]>[0]) {
      return withScopes(() => lifecycle.archiveSavedItem(input));
    },
    reopenSavedItem(input: Parameters<SavedItemLifecycle["reopenSavedItem"]>[0]) {
      return withScopes(() => lifecycle.reopenSavedItem(input));
    },
    resolveSavedItem(input: Parameters<SavedItemLifecycle["resolveSavedItem"]>[0]) {
      return withScopes(() => lifecycle.resolveSavedItem(input));
    },
    promoteSavedItemToGeneralAction(
      input: Parameters<SavedItemLifecycle["promoteSavedItemToGeneralAction"]>[0],
    ) {
      return lifecycle.promoteSavedItemToGeneralAction(input).then((promotion) => ({
        result: promotion.savedItem,
        affectedScopes: [
          ...affectedScopesForSavedItem(promotion.savedItem),
          ...promotion.affectedGeneralActionScopes,
        ],
      }));
    },
    async deleteUniqueSavedItemSource(
      input: Parameters<SavedItemLifecycle["deleteUniqueSavedItemSource"]>[0],
    ) {
      const current = await lifecycle.getSavedItem({
        callerUserId: input.actorUserId,
        savedItemId: input.savedItemId,
      });
      const result = await lifecycle.deleteUniqueSavedItemSource(input);
      return {
        result,
        affectedScopes: current ? affectedScopesForSavedItem(current) : [],
      };
    },
  };
}
