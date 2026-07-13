import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemoryGeneralActionStore } from "../general-actions/in-memory-store";
import type {
  GeneralActionStore,
  InMemoryGeneralActionLifecycleStore,
} from "../general-actions/types";
import type { InMemorySourceRecordStore } from "../source-records/types";
import type { AssetEvidenceStore } from "./evidence-types";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import type { AssetLinkStore } from "./link-types";
import type { AssetReviewStore, GeneralActionAssetLinkStore } from "./review-types";
import type { AssetStore } from "./types";

/**
 * The full in-memory bridge store (#199): the asset review lifecycle composition
 * — assets, memories, evidence, context links, source records — plus a General
 * Action store layered over the *same* household instance (the review store
 * satisfies `HouseholdStore`, so its bound household methods are passed straight
 * through), keeping scope rules in agreement across both domains. What
 * `createAssetActionLinks` and `createAssetHistory` run against in tests.
 */
export function createInMemoryAssetActionLinkStore(): AssetStore &
  AssetReviewStore &
  AssetEvidenceStore &
  AssetLinkStore &
  GeneralActionAssetLinkStore &
  GeneralActionStore &
  InMemorySourceRecordStore &
  InMemoryGeneralActionLifecycleStore {
  const reviewLifecycleStore = createInMemoryAssetReviewLifecycleStore();
  return {
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(reviewLifecycleStore),
    ...reviewLifecycleStore,
  };
}
