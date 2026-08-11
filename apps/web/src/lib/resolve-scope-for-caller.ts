import { listActiveHouseholdMembershipsForUser } from "@tendnote/db/queries/households";
import type { PrivacyScope, VisibilityChoice } from "@tendnote/domain/privacy";
import { scopeForVisibilityChoice } from "@tendnote/domain/privacy";

/**
 * Resolves a visibility choice to a persisted scope plus the caller's active
 * household, shared by the General Action and Asset server actions so the choice
 * → scope resolution never forks. A non-private choice binds to the caller's
 * household; the shared lifecycle then fails closed if it is missing or the
 * member is inactive (ADR 0153).
 *
 * Taking the first active membership is deterministic rather than arbitrary:
 * the one-active-household rule is now enforced where memberships are created.
 * Creation refuses a caller who already has one, and invitation acceptance
 * re-decides the same rule inside its transaction (ADR 0213), so this list holds
 * at most one row. Should multi-household ever be a product, this becomes an
 * explicit household chooser — not a silent first-row default.
 */
export async function resolveScopeForCaller(
  ownerUserId: string,
  visibilityChoice: VisibilityChoice,
): Promise<{ scope: PrivacyScope; householdId: string | null }> {
  const scope = scopeForVisibilityChoice(visibilityChoice);
  if (scope === "private") {
    return { scope, householdId: null };
  }
  const memberships = await listActiveHouseholdMembershipsForUser({ userId: ownerUserId });
  return { scope, householdId: memberships[0]?.householdId ?? null };
}
