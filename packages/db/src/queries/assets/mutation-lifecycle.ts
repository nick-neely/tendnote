import type { MutationOutcome } from "../affected-scopes";
import { affectedScopesForAsset, affectedScopesForAssetIds } from "./affected-scopes";
import type { createAssetLifecycle } from "./lifecycle";

type AssetLifecycle = ReturnType<typeof createAssetLifecycle>;

export function createAffectedAssetLifecycle(lifecycle: AssetLifecycle) {
  return {
    ...lifecycle,
    async createAsset(
      input: Parameters<AssetLifecycle["createAsset"]>[0],
    ): Promise<MutationOutcome<Awaited<ReturnType<AssetLifecycle["createAsset"]>>>> {
      const result = await lifecycle.createAsset(input);
      return { result, affectedScopes: affectedScopesForAsset(result) };
    },
    async editAsset(input: Parameters<AssetLifecycle["editAsset"]>[0]) {
      const result = await lifecycle.editAsset(input);
      return { result, affectedScopes: affectedScopesForAsset(result) };
    },
    async archiveAsset(input: Parameters<AssetLifecycle["archiveAsset"]>[0]) {
      const result = await lifecycle.archiveAsset(input);
      return { result, affectedScopes: affectedScopesForAsset(result) };
    },
    async restoreAsset(input: Parameters<AssetLifecycle["restoreAsset"]>[0]) {
      const result = await lifecycle.restoreAsset(input);
      return { result, affectedScopes: affectedScopesForAsset(result) };
    },
    async hardDeleteAsset(input: Parameters<AssetLifecycle["hardDeleteAsset"]>[0]) {
      const current = await lifecycle.getAsset({
        callerUserId: input.actorUserId,
        assetId: input.assetId,
      });
      const result = await lifecycle.hardDeleteAsset(input);
      return {
        result,
        affectedScopes: current
          ? affectedScopesForAsset(current)
          : affectedScopesForAssetIds({
              ownerUserId: input.actorUserId,
              assetIds: [input.assetId],
            }),
      };
    },
  };
}
