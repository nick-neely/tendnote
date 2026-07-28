import type { MutationOutcome } from "../affected-scopes";
import {
  affectedScopesForAsset,
  affectedScopesForAssetIds,
  affectedScopesForGeneralActionIds,
} from "./affected-scopes";
import type { AssetReviewGroupResult } from "./review-types";

export async function reviewMutationOutcome(
  run: Promise<AssetReviewGroupResult>,
): Promise<MutationOutcome<AssetReviewGroupResult>> {
  const result = await run;
  return { result, affectedScopes: affectedScopesForAsset(result.asset) };
}

export async function assetIdsMutationOutcome<TResult>(
  run: Promise<TResult>,
  ownerUserId: string,
  assetIds: (result: TResult) => readonly string[],
): Promise<MutationOutcome<TResult>> {
  const result = await run;
  return {
    result,
    affectedScopes: affectedScopesForAssetIds({ ownerUserId, assetIds: assetIds(result) }),
  };
}

export async function assetAndGeneralActionMutationOutcome<TResult>(
  run: Promise<TResult>,
  input: {
    ownerUserId: string;
    asset: (result: TResult) => Parameters<typeof affectedScopesForAsset>[0];
    generalActionIds: (result: TResult) => readonly string[];
  },
): Promise<MutationOutcome<TResult>> {
  const result = await run;
  return {
    result,
    affectedScopes: [
      ...affectedScopesForAsset(input.asset(result)),
      ...affectedScopesForGeneralActionIds({
        ownerUserId: input.ownerUserId,
        generalActionIds: input.generalActionIds(result),
      }),
    ],
  };
}
