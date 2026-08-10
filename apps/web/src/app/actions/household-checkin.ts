"use server";

import { setHouseholdCheckinEnabled } from "@tendnote/db/queries/access-profiles";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

const setCheckinSchema = z.object({ enabled: z.boolean() });

/**
 * Turning this member's Household check-in on or off.
 *
 * The subject is the signed-in owner and there is deliberately no argument for
 * whose check-in this is: opting in is a decision only the member themselves can
 * make, and adding a target here would be the cross-member enrollment Phase Eight
 * refuses (ADR 0220). Turning it off changes no household record and nothing any
 * other member sees.
 *
 * The scopes named are the member's own briefing surfaces, because that is the
 * whole blast radius: a preference that decides whether one person's brief shows
 * a section changes nothing about the household.
 */
export async function setHouseholdCheckinAction(input: { enabled: boolean }) {
  return runOwnerAction({
    schema: setCheckinSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const enabled = await setHouseholdCheckinEnabled({
        userId: ownerUserId,
        enabled: parsed.enabled,
      });
      return { enabled };
    },
    affectedScopes: (_outcome, ownerUserId) => [
      { kind: "owner-collection", collection: "today", ownerUserId },
      { kind: "owner-collection", collection: "briefs", ownerUserId },
    ],
    result: ({ enabled }) => ({ enabled }),
  });
}
