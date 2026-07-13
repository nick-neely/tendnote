import { AssetValidationError, GeneralActionValidationError } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { runSurfaceMutation } from "@/lib/surface-mutation";

/**
 * Runs a mutation on the Actions surface through the shared surface runner,
 * revalidating the page on success and surfacing curated
 * `GeneralActionValidationError` messages inline. The single result-union runner
 * behind both the Action and Area server actions.
 */
export async function runActionsMutation<TEntity, TView>(
  run: () => Promise<TEntity>,
  toView: (entity: TEntity) => TView,
): Promise<{ ok: true; view: TView } | { ok: false; error: string }> {
  return runSurfaceMutation(run, toView, {
    // Asset validation joins the curated set for hint promotion (#199): the
    // review-gated bridge throws user-safe asset messages from an Actions row.
    domainValidationMessage: (error) =>
      error instanceof GeneralActionValidationError || error instanceof AssetValidationError
        ? error.message
        : null,
    // Re-render the Actions surface so server-rendered lists, the filter, and any
    // Area labels reflect the change. Scoped to the one page (calm, narrow
    // revalidation); the interactive lists manage their own optimistic state.
    revalidate: () => revalidatePath("/actions"),
  });
}
