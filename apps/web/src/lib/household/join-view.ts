import "server-only";

import {
  listActiveHouseholdMembershipsForUser,
  viewHouseholdInvitation,
} from "@tendnote/db/queries/households";
import type { HouseholdJoinDecision } from "@tendnote/domain/household-invitations";
import { getCurrentAccess } from "@/lib/access/current-access";

/**
 * What the join page renders. The lifecycle's own decision, plus one state that
 * belongs to Tendnote's front door rather than to households: a recipient whose
 * Private Beta Access has not been granted yet.
 */
export type HouseholdJoinView = HouseholdJoinDecision | { state: "access-pending" };

/**
 * Resolves the join page's state for the person holding this link.
 *
 * Access is layered *outside* the invitation decision on purpose. The shared
 * lifecycle answers only "may this session use this capability"; whether the
 * session may use Tendnote at all is a separate gate, and folding the two
 * together would let a pending account be told apart from an admitted one before
 * the invited address was proven. So a pending visitor is run through the same
 * decision as anyone else, and only a decision that already reached `ready` —
 * meaning the address matched — is swapped for the access explanation.
 */
export async function resolveHouseholdJoinView(secret: string): Promise<HouseholdJoinView> {
  const access = await getCurrentAccess();

  if (access.state === "unauthenticated") {
    return viewHouseholdInvitation({ secret, viewer: null });
  }

  const activeHouseholds =
    access.state === "admitted"
      ? (await listActiveHouseholdMembershipsForUser({ userId: access.user.id })).length
      : 0;

  const decision = await viewHouseholdInvitation({
    secret,
    viewer: { userId: access.user.id, email: access.user.email, activeHouseholds },
  });

  if (access.state === "pending" && decision.state === "ready") {
    return { state: "access-pending" };
  }
  return decision;
}
