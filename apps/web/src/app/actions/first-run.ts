"use server";

import { closeFirstRun, closeIntegrationOffer } from "@tendnote/db/queries/first-run";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";
import type { OwnerActionResult } from "@/lib/owner-action-result";

const emptyInputSchema = z.undefined();

/** The owner skipped the first-run prompt (#639). */
export async function skipFirstRunAction(): Promise<OwnerActionResult<null>> {
  return runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => closeFirstRun({ userId: ownerUserId }),
    affectedScopes: (_state, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: () => null,
  });
}

/** The owner followed or set aside the post-First-Value integrations offer (#639). */
export async function closeIntegrationOfferAction(): Promise<OwnerActionResult<null>> {
  return runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => closeIntegrationOffer({ userId: ownerUserId }),
    affectedScopes: (_state, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: () => null,
  });
}
