"use server";

import { proposeAssetMemoryActions } from "@tendnote/db/queries/assets";
import { z } from "zod";
import type { AssetActionProposalMutationResult } from "@/lib/asset-action-proposal-view";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * Server action for the Asset Profile's reminder proposals (#203): the owner asks their
 * asset's reviewed details to suggest General Actions — a warranty check, a filter
 * replacement Routine — and the proposals land in review, never on the ledger.
 *
 * Thin over the owner-scoped proposal seam, which owns the planning rule, the cap, the
 * idempotency, the scope clamp, and the audit trail. Accepting, editing, dismissing, and
 * ignoring what this proposes are NOT here: those are the existing Suggested General
 * Action server actions, unchanged. There is no asset-side review path, and adding one
 * would fork the lifecycle #196 insists stays single.
 */

const proposeSchema = z.object({ assetId: z.uuid() });

export async function proposeAssetMemoryActionsAction(input: {
  assetId: string;
}): Promise<AssetActionProposalMutationResult> {
  return runOwnerAction({
    schema: proposeSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      proposeAssetMemoryActions({
        actorUserId: ownerUserId,
        assetId: parsed.assetId,
        source: "user",
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => {
      const result = outcome.result;
      return {
        proposed: result.proposed.length,
        // Carried through so an empty pass can say which kind of empty it was — see
        // `describeProposalOutcome`.
        alreadySpokenFor: result.alreadySpokenFor,
      };
    },
  });
}
