import type { MutationOutcome } from "../affected-scopes";
import { affectedScopesForSavedItem } from "../assets/affected-scopes";
import type { createHouseholdSavedItemCollaboration } from "./household-native";
import type { createSavedItemLifecycle } from "./lifecycle";

type SavedItemLifecycle = ReturnType<typeof createSavedItemLifecycle>;
type HouseholdSavedItemCollaboration = ReturnType<typeof createHouseholdSavedItemCollaboration>;

type ScopedSavedItem = {
  id: string;
  ownerUserId: string | null;
  householdId?: string | null;
  sharedWithUserIds?: readonly string[];
};

export function createAffectedSavedItemLifecycle(lifecycle: SavedItemLifecycle) {
  async function withScopes<TResult extends ScopedSavedItem>(
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

/**
 * The same reconciliation contract for the household-native boundary.
 *
 * Separate from the owner-scoped wrapper above rather than folded into it, for
 * the same reason the boundaries themselves are separate: one object exposing
 * both would let a surface reach an owner-scoped mutation while holding what it
 * believes is a household one.
 */
export function createAffectedHouseholdSavedItemCollaboration(
  collaboration: HouseholdSavedItemCollaboration,
) {
  async function withScopes<TResult extends ScopedSavedItem>(
    run: () => Promise<TResult>,
  ): Promise<MutationOutcome<TResult>> {
    const result = await run();
    return { result, affectedScopes: affectedScopesForSavedItem(result) };
  }

  return {
    ...collaboration,
    createHouseholdSavedItem(
      input: Parameters<HouseholdSavedItemCollaboration["createHouseholdSavedItem"]>[0],
    ) {
      return withScopes(() => collaboration.createHouseholdSavedItem(input));
    },
    editHouseholdSavedItem(
      input: Parameters<HouseholdSavedItemCollaboration["editHouseholdSavedItem"]>[0],
    ) {
      return withScopes(() => collaboration.editHouseholdSavedItem(input));
    },
    archiveHouseholdSavedItem(
      input: Parameters<HouseholdSavedItemCollaboration["archiveHouseholdSavedItem"]>[0],
    ) {
      return withScopes(() => collaboration.archiveHouseholdSavedItem(input));
    },
    restoreHouseholdSavedItem(
      input: Parameters<HouseholdSavedItemCollaboration["restoreHouseholdSavedItem"]>[0],
    ) {
      return withScopes(() => collaboration.restoreHouseholdSavedItem(input));
    },
    resolveHouseholdSavedItem(
      input: Parameters<HouseholdSavedItemCollaboration["resolveHouseholdSavedItem"]>[0],
    ) {
      return withScopes(() => collaboration.resolveHouseholdSavedItem(input));
    },
    promoteHouseholdSavedItem(
      input: Parameters<HouseholdSavedItemCollaboration["promoteHouseholdSavedItem"]>[0],
    ) {
      return collaboration.promoteHouseholdSavedItem(input).then((promotion) => ({
        result: promotion.savedItem,
        affectedScopes: [
          ...affectedScopesForSavedItem(promotion.savedItem),
          ...promotion.affectedGeneralActionScopes,
        ],
      }));
    },
  };
}
