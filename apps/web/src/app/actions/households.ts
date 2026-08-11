"use server";

import { createHousehold, getHouseholdOverviewForUser } from "@tendnote/db/queries/households";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { z } from "zod";
import type { OwnerActionResult } from "@/lib/owner-action";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * The wire bound only, deliberately looser than the rule.
 *
 * The real limit is the domain policy seam's `HOUSEHOLD_NAME_LIMIT` (60), and
 * `parseHouseholdName` is what enforces it, so the surface renders the same
 * curated message the shared lifecycle raises rather than a second, drifting
 * copy of it. This 200 exists purely to stop an unbounded string reaching the
 * parser; a name between 61 and 200 characters passes here and is then refused
 * by the policy with the message a user can act on. Tightening it to 60 would
 * turn that into a generic schema failure, which is worse copy for no gain.
 */
const createHouseholdActionSchema = z.object({ name: z.string().max(200) }).strict();

export type CreateHouseholdActionInput = { name: string };
export type HouseholdOverviewResult = OwnerActionResult<HouseholdOverview>;

/**
 * Creates one immediately active Household Workspace with the caller as its sole
 * active Owner, then answers with the Overview they return to.
 *
 * Admission is re-decided in the shared lifecycle, so a caller who is already in
 * a household gets the private conflict explanation as action data — the surface
 * renders it in place instead of navigating or switching context.
 */
export async function createHouseholdAction(
  input: CreateHouseholdActionInput,
): Promise<HouseholdOverviewResult> {
  return runOwnerAction({
    schema: createHouseholdActionSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await createHousehold({ ownerUserId, name: parsed.name });
      const overview = await getHouseholdOverviewForUser({ userId: ownerUserId });
      if (!overview) {
        throw new Error("Household overview unavailable after creation.");
      }
      return overview;
    },
    affectedScopes: (_overview, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (overview) => overview,
  });
}
