import { ZodError } from "zod";

/**
 * How a record family plugs into the shared mutation runner: which curated domain
 * errors are user-safe to surface inline, and which surface paths to re-render on
 * success.
 */
export type SurfaceMutationOptions = {
  /** Maps a curated domain validation error to its user-safe message, or `null`. */
  domainValidationMessage: (error: unknown) => string | null;
  /** Revalidates the family's surface paths after a successful write. */
  revalidate: () => void;
};

/**
 * Maps a caught error to a user-safe message, or `null` when it is not a
 * validation failure. Zod field errors (a blank name, a fat-fingered URL) and the
 * family's curated domain lifecycle errors surface inline; everything else stays
 * generic and re-throws so the client shows its fallback.
 */
function validationMessage(error: unknown, options: SurfaceMutationOptions): string | null {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Check the highlighted fields and try again.";
  }
  return options.domainValidationMessage(error);
}

/**
 * Runs a mutation for a surface, revalidating its pages on success and returning
 * a validation message as data instead of throwing so the surface can show it
 * inline. Unknown/infra failures re-throw. Kept temporarily for record families
 * that have not yet migrated to the owner-action protocol.
 */
export async function runSurfaceMutation<TEntity, TView>(
  run: () => Promise<TEntity>,
  toView: (entity: TEntity) => TView,
  options: SurfaceMutationOptions,
): Promise<{ ok: true; view: TView } | { ok: false; error: string }> {
  try {
    const entity = await run();
    options.revalidate();
    return { ok: true, view: toView(entity) };
  } catch (error) {
    const message = validationMessage(error, options);
    if (message) {
      return { ok: false, error: message };
    }
    throw error;
  }
}
