"use server";

import { searchGlobalRecall } from "@tendnote/db/queries/global-recall";
import {
  type GlobalRecallInput,
  globalRecallInputSchema,
  globalRecallResponseSchema,
} from "@tendnote/domain/global-recall";
import { runOwnerAction } from "@/lib/owner-action";

/** Authenticated Web adapter over the shared owner-scoped Global Recall product seam. */
export async function globalRecallAction(input: GlobalRecallInput) {
  return runOwnerAction({
    schema: globalRecallInputSchema,
    input,
    budget: { costCategory: "embedding" },
    body: ({ ownerUserId, input: parsed }) => searchGlobalRecall({ ...parsed, ownerUserId }),
    result: (response) => globalRecallResponseSchema.parse(response),
  });
}
