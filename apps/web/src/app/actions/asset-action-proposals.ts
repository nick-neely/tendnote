"use server";

import { proposeAssetMemoryActions } from "@tendnote/db/queries/assets";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type { AssetActionProposalMutationResult } from "@/lib/asset-action-proposal-view";
import { runAssetsMutation } from "@/lib/asset-mutation";

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
  const { assetId } = proposeSchema.parse(input);
  const actorUserId = await requireAdmittedOwnerForAction();

  return runAssetsMutation(
    () => proposeAssetMemoryActions({ actorUserId, assetId, source: "user" }),
    (outcome) => ({ proposed: outcome.proposed.length }),
  );
}
