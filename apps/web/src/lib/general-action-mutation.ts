import { GeneralActionValidationError } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

/**
 * Maps a caught error to a user-safe message, or `null` when it is not a validation
 * failure. Zod field errors (a fat-fingered link URL, a too-long name) and curated
 * domain lifecycle errors are surfaced; everything else stays generic and re-throws
 * so the client shows its fallback. Shared by the Action and Area server actions so
 * the two never drift.
 */
function actionValidationMessage(error: unknown): string | null {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Check the highlighted fields and try again.";
  }
  if (error instanceof GeneralActionValidationError) {
    return error.message;
  }
  return null;
}

/**
 * Runs a mutation on the Actions surface, revalidating the page on success and
 * returning a validation message as data instead of throwing so the surface can
 * show it inline. Unknown/infra failures re-throw. The single result-union runner
 * behind both the Action and Area server actions.
 */
export async function runActionsMutation<TEntity, TView>(
  run: () => Promise<TEntity>,
  toView: (entity: TEntity) => TView,
): Promise<{ ok: true; view: TView } | { ok: false; error: string }> {
  try {
    const entity = await run();
    // Re-render the Actions surface so server-rendered lists, the filter, and any
    // Area labels reflect the change. Scoped to the one page (calm, narrow
    // revalidation); the interactive lists manage their own optimistic state.
    revalidatePath("/actions");
    return { ok: true, view: toView(entity) };
  } catch (error) {
    const message = actionValidationMessage(error);
    if (message) {
      return { ok: false, error: message };
    }
    throw error;
  }
}
