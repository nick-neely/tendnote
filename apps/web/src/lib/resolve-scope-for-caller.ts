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
 * Phases 5/6 treat a user as belonging to at most one household (the product
 * model is a single household), so we deliberately take the first active
 * membership. If a user ever holds several, this picks one arbitrarily rather
 * than guessing — surfacing an explicit household chooser is future
 * multi-household work, not a silent default we want to pretend is correct here.
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
