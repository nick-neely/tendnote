import "server-only";

import {
  listActiveHouseholdMembershipsForUser,
  viewHouseholdInvitation,
} from "@tendnote/db/queries/households";
import type { HouseholdJoinDecision } from "@tendnote/domain/household-invitations";
import { getCurrentAccess } from "@/lib/access/current-access";

/** The one decision that names anything, plus what Tendnote's front door knows. */
export type HouseholdJoinReady = Extract<HouseholdJoinDecision, { state: "ready" }> & {
  /**
   * True when this account has no Private Beta Access yet. The invitation is
   * still usable; only the rest of Tendnote is not.
   */
  accessPending: boolean;
};

/**
 * What the join page renders: the lifecycle's own decision, carrying one extra
 * fact on the state where the invited address has been proven.
 */
export type HouseholdJoinView =
  | Exclude<HouseholdJoinDecision, { state: "ready" }>
  | HouseholdJoinReady;

/**
 * Resolves the join page's state for the person holding this link.
 *
 * Access is layered *outside* the invitation decision on purpose, and the two
 * gates answer different questions. The shared lifecycle answers "may this
 * session use this capability"; Private Beta Access answers "may this session
 * use Tendnote at all". Folding them together would let a pending account be
 * told apart from an admitted one before the invited address was proven, so a
 * pending visitor is run through the same decision as anyone else and the access
 * fact is attached only to a decision that already reached `ready`.
 *
 * What that fact does *not* do is refuse. Private Beta Access is the global
 * denier for the site; it is not a household's doorman. A pending recipient may
 * accept and hold a real membership, and Tendnote opens for them later - so the
 * page explains that rather than turning them away from an invitation that will
 * expire while they wait.
 */
export async function resolveHouseholdJoinView(secret: string): Promise<HouseholdJoinView> {
  const access = await getCurrentAccess();
  const decision = await viewHouseholdInvitation({ secret, viewer: await viewerFor(access) });

  return decision.state === "ready"
    ? { ...decision, accessPending: access.state === "pending" }
    : decision;
}

/**
 * The viewer the shared lifecycle decides against, or `null` for a session that
 * has proved no address at all.
 *
 * A pending account is counted exactly like an admitted one. A membership
 * accepted while waiting is a real membership, so "how many households does this
 * viewer already hold" has the same answer either way; assuming zero would show
 * a second invitation as ready and let the one-household rule refuse it a press
 * later.
 */
async function viewerFor(access: Awaited<ReturnType<typeof getCurrentAccess>>) {
  if (access.state === "unauthenticated") return null;

  const memberships = await listActiveHouseholdMembershipsForUser({ userId: access.user.id });
  return { userId: access.user.id, email: access.user.email, activeHouseholds: memberships.length };
}
