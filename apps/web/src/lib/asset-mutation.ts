import { AssetValidationError } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { runSurfaceMutation } from "@/lib/surface-mutation";

/**
 * Runs an Asset mutation through the shared surface runner, revalidating the
 * Assets surface (and the asset's profile) on success and surfacing curated
 * `AssetValidationError` messages inline. Unknown/infra failures re-throw so the
 * client shows its generic fallback.
 */
export async function runAssetsMutation<TEntity, TView>(
  run: () => Promise<TEntity>,
  toView: (entity: TEntity) => TView,
): Promise<{ ok: true; view: TView } | { ok: false; error: string }> {
  return runSurfaceMutation(run, toView, {
    domainValidationMessage: (error) =>
      error instanceof AssetValidationError ? error.message : null,
    // Re-render the Assets surface and any open profile so server-rendered lists
    // and metadata reflect the change; the interactive lists manage their own
    // optimistic state (mirrors the Actions runner's narrow revalidation).
    revalidate: () => {
      revalidatePath("/assets");
      revalidatePath("/assets/[assetId]", "page");
    },
  });
}
