import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemoryGeneralActionStore } from "../general-actions/in-memory-store";
import type {
  GeneralActionStore,
  InMemoryGeneralActionLifecycleStore,
} from "../general-actions/types";
import type { AssetEvidenceStore } from "./evidence-types";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import type { AssetReviewStore, GeneralActionAssetLinkStore } from "./review-types";
import type { AssetStore } from "./types";

/**
 * The full in-memory bridge store (#199): the asset review lifecycle composition
 * plus a General Action store layered over the *same* household instance (the
 * review store satisfies `HouseholdStore`, so its bound household methods are
 * passed straight through), keeping scope rules in agreement across both domains
 * — what `createAssetActionLinks` and its tests run against.
 */
export function createInMemoryAssetActionLinkStore(): AssetStore &
  AssetReviewStore &
  AssetEvidenceStore &
  GeneralActionAssetLinkStore &
  GeneralActionStore &
  InMemoryGeneralActionLifecycleStore {
  const reviewLifecycleStore = createInMemoryAssetReviewLifecycleStore();
  return {
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(reviewLifecycleStore),
    ...reviewLifecycleStore,
  };
}
