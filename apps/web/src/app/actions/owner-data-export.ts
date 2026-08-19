"use server";

import {
  getLatestOwnerDataExportJob,
  type OwnerDataExportJob,
} from "@tendnote/db/queries/owner-data-export";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enqueueAndPublishOwnerDataExportJob } from "@/lib/background-jobs/owner-data-export-queue";
import { runOwnerAction } from "@/lib/owner-action";

const emptyInputSchema = z.undefined();

export async function requestOwnerDataExportAction(): Promise<
  { ok: true; view: OwnerDataExportJob } | { ok: false; error: string }
> {
  const result = await runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: async ({ ownerUserId }) => {
      const latest = await getLatestOwnerDataExportJob(ownerUserId);
      if (latest?.status === "pending" || latest?.status === "running") {
        return latest;
      }

      const enqueueResult = await enqueueAndPublishOwnerDataExportJob({ ownerUserId });
      return enqueueResult.job;
    },
    affectedScopes: (_job, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (job) => job,
  });
  if (result.ok) revalidatePath("/account");
  return result;
}
