"use server";

import {
  getLatestOwnerDataExportJob,
  type OwnerDataExportJob,
  ownerDataExportRequestIdempotencyKey,
} from "@tendnote/db/queries/owner-data-export";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enqueueAndPublishOwnerDataExportJob } from "@/lib/background-jobs/owner-data-export-queue";
import { runAccountOwnerAction } from "@/lib/owner-action";

const emptyInputSchema = z.undefined();

/**
 * Request an owner data export. Open to any signed-in account, admitted or not,
 * because export is an exit and the pending area offers it too (#607).
 */
export async function requestOwnerDataExportAction(): Promise<
  { ok: true; view: OwnerDataExportJob } | { ok: false; error: string }
> {
  const result = await runAccountOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: async ({ ownerUserId }) => {
      const latest = await getLatestOwnerDataExportJob(ownerUserId);
      if (
        latest?.status === "pending" ||
        latest?.status === "running" ||
        latest?.status === "failed"
      ) {
        return latest;
      }

      const enqueueResult = await enqueueAndPublishOwnerDataExportJob({
        ownerUserId,
        idempotencyKey: ownerDataExportRequestIdempotencyKey(latest),
      });
      return enqueueResult.job;
    },
    affectedScopes: (_job, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (job) => job,
  });
  if (result.ok) {
    revalidatePath("/account");
    revalidatePath("/pending");
    revalidatePath("/lapsed");
    revalidatePath("/restricted");
  }
  return result;
}
