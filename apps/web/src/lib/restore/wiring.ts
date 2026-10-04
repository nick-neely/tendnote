import "server-only";

import {
  isOutboundPaused,
  pauseOutbound,
  resumeOutbound,
} from "@tendnote/db/queries/outbound-pause";
import { blobRecoveryJournalStore } from "@tendnote/db/queries/recovery-journal";
import {
  areDatabaseWritesStopped,
  countFencedUnfinishedExportJobs,
  countSessions,
  deleteAllSessions,
  endOtherConnections,
  findRecordedOperatorActions,
  isDeletionSubjectPresent,
  listAccountDeletionIntentRecords,
  markFencedExportJobs,
  reapplyDeletionRecord,
  setDatabaseWritesStopped,
} from "@tendnote/db/queries/restore";
import {
  countRestoredEmailFences,
  recordRestoredEmailFences,
} from "@tendnote/db/queries/restored-email-fences";
import { parseAdmissionPolicy } from "@tendnote/domain";
import Stripe from "stripe";
import { paidAccessProjection } from "@/lib/billing/paid-access-projection";
import { createStripeReconciliation } from "@/lib/billing/stripe-reconciliation";
import { getRedis } from "@/lib/cache/redis";
import type { RestoreDependencies } from "./procedure";
import { redisSessionCache } from "./redis-sessions";

/** The production adapters behind the restore steps. */
export function restoreDependencies(): RestoreDependencies {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  return {
    journal: blobRecoveryJournalStore,
    database: {
      pauseOutbound,
      resumeOutbound,
      isOutboundPaused,
      setWritesStopped: setDatabaseWritesStopped,
      areWritesStopped: areDatabaseWritesStopped,
      endOtherConnections,
      listAccountDeletionIntentRecords,
      reapplyDeletionRecord,
      isDeletionSubjectPresent,
      findRecordedOperatorActions,
      recordRestoredEmailFences,
      countRestoredEmailFences,
      markFencedExportJobs,
      countFencedUnfinishedExportJobs,
      deleteAllSessions,
      countSessions,
    },
    sessionCache: redisSessionCache(getRedis()),
    // The same job the cron runs. Its emails go through the held sender, so a
    // fenced one completes silently and any other fails as a reported stage.
    reconcileStripe: createStripeReconciliation({
      ...paidAccessProjection,
      policy: parseAdmissionPolicy(),
      stripe: secretKey ? new Stripe(secretKey) : null,
      logger: console,
    }),
  };
}

/** Ends the connections the steps opened, so the CLI process can exit. */
export async function closeRestoreConnections(): Promise<void> {
  await getRedis()
    .quit()
    .catch(() => {});
}
