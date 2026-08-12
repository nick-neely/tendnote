import { HouseholdRecordUnavailableError } from "@tendnote/domain";
import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createGeneralActionAuthority } from "../general-actions/household-authority";
import { createInMemoryGeneralActionStore } from "../general-actions/in-memory-store";
import type {
  GeneralActionStore,
  InMemoryGeneralActionLifecycleStore,
} from "../general-actions/types";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";

/**
 * The full in-memory bridge store (#199): the asset review lifecycle composition
 * plus a General Action store layered over the *same* household instance (the
 * review store satisfies `HouseholdStore`, so its bound household methods are
 * passed straight through), keeping scope rules in agreement across both domains
 * — what `createAssetActionLinks` and its tests run against.
 */
export function createInMemoryAssetActionLinkStore(): ReturnType<
  typeof createInMemoryAssetReviewLifecycleStore
> &
  GeneralActionStore &
  InMemoryGeneralActionLifecycleStore {
  const reviewLifecycleStore = createInMemoryAssetReviewLifecycleStore();
  const generalActionStore = createInMemoryGeneralActionStore(reviewLifecycleStore);
  const generalActionAuthority = createGeneralActionAuthority({
    ...generalActionStore,
    ...reviewLifecycleStore,
  });
  return {
    ...createInMemoryGeneralActionAreaStore(),
    ...generalActionStore,
    ...reviewLifecycleStore,
    async listAuthorizedGeneralActionAssetLinkActionIds(input) {
      const authorized: string[] = [];
      for (const generalActionId of new Set(input.generalActionIds)) {
        const owned = await generalActionStore.getGeneralAction({
          ownerUserId: input.callerUserId,
          generalActionId,
        });
        const visible = owned
          ? owned
          : await generalActionStore.getVisibleGeneralAction({
              callerUserId: input.callerUserId,
              generalActionId,
            });
        if (!visible) continue;
        try {
          await generalActionAuthority.requireGeneralActionAuthority({
            actorUserId: input.callerUserId,
            action: visible,
            operation: "edit",
          });
          authorized.push(generalActionId);
        } catch (error) {
          if (!(error instanceof HouseholdRecordUnavailableError)) throw error;
        }
      }
      return authorized;
    },
  };
}
