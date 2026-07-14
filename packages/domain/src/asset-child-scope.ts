import { z } from "zod";
import { AssetValidationError } from "./assets";
import type { PrivacyScope } from "./privacy";

/**
 * The visibility a child record under an Asset (an Asset Memory, Asset Evidence)
 * can hold in Phase 6: private or household. A selected-shared child audience is
 * deferred — additive later, never assumed — so no child share rows exist yet
 * (#198, #200).
 */
export const assetChildScopeSchema = z.enum(["private", "household"]);
export type AssetChildScope = z.infer<typeof assetChildScopeSchema>;

// How wide each scope reaches, for the child-scope ceiling: a household record
// reaches every active member, a shared one a selected few, a private one only
// its owner. Children may sit at or below their Asset's rank, never above.
const SCOPE_REACH: Record<PrivacyScope, number> = { private: 0, shared: 1, household: 2 };

/**
 * The child-scope ceiling (#196): an Asset's scope is the broadest visibility any
 * child record may hold. A private detail under a household Asset is fine; a
 * household detail under a private (or selected-shared) Asset would widen the
 * audience and is rejected fail-closed. One rule for every Asset child — memories
 * and evidence never drift apart.
 */
export function requireChildScopeWithinAsset(input: {
  childScope: AssetChildScope;
  assetScope: PrivacyScope;
}): void {
  if (SCOPE_REACH[input.childScope] > SCOPE_REACH[input.assetScope]) {
    throw new AssetValidationError(
      "A detail can't be more visible than its asset — narrow it or widen the asset first.",
    );
  }
}

/**
 * The visibility a new child record defaults to under an Asset: the Asset's own
 * scope where this slice supports it (household), otherwise private. Fail-closed —
 * a selected-shared Asset defaults its children to private rather than guessing an
 * audience this slice cannot represent.
 */
export function defaultChildScopeForAsset(assetScope: PrivacyScope): AssetChildScope {
  return assetScope === "household" ? "household" : "private";
}

/**
 * Re-resolves a child record's visibility when duplicate review re-anchors it to
 * an existing Asset (#198): the record keeps its scope where the target allows it
 * and is clamped to private otherwise, adopting the target's household.
 * Deterministic and fail-closed — linking never widens who can see a detail.
 */
export function resolveLinkedChildVisibility(input: {
  childScope: AssetChildScope;
  target: { scope: PrivacyScope; householdId: string | null };
}): { scope: AssetChildScope; householdId: string | null } {
  if (input.childScope === "household" && input.target.scope === "household") {
    return { scope: "household", householdId: input.target.householdId };
  }
  return { scope: "private", householdId: null };
}
