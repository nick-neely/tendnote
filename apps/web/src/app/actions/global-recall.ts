"use server";

import { searchGlobalRecall } from "@tendnote/db/queries/global-recall";
import {
  type GlobalRecallInput,
  type GlobalRecallResponse,
  globalRecallInputSchema,
  globalRecallResponseSchema,
} from "@tendnote/domain/global-recall";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

/** Authenticated Web adapter over the shared owner-scoped Global Recall product seam. */
export async function globalRecallAction(input: GlobalRecallInput): Promise<GlobalRecallResponse> {
  const parsed = globalRecallInputSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return globalRecallResponseSchema.parse(await searchGlobalRecall({ ...parsed, ownerUserId }));
}
