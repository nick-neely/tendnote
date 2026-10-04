import "server-only";

import { requestAccountDeletion } from "@tendnote/db/queries/account-deletion";
import {
  type AccountRetentionSweepResult,
  createDrizzleAccountRetentionStore,
  runAccountRetentionSweep,
} from "@tendnote/db/queries/account-retention";
import { assertHouseholdAccountDeletionAllowed } from "@tendnote/db/queries/households";
import { sendDeletionNoticeEmail } from "./deletion-notice-email";

/**
 * Carries out retention deadlines (#621): the deletion notices for every Lapsed
 * and Terminated account, and the purge of each whose deadline has passed,
 * through the same deletion path an owner's own request takes. The deletion
 * wiring is loaded on use, as the recovery cron loads it, so importing this
 * never reaches the auth server.
 */
export async function carryOutRetentionDeadlines(input: {
  limit: number;
}): Promise<AccountRetentionSweepResult> {
  const { accountDeletionDependencies } = await import("@/lib/auth/account-deletion");
  const { revokeUserSessions } = await import("@/lib/auth/server");
  const deletion = accountDeletionDependencies(revokeUserSessions);
  return runAccountRetentionSweep({
    store: createDrizzleAccountRetentionStore(),
    sendNotice: sendDeletionNoticeEmail,
    assertDeletionAllowed: assertHouseholdAccountDeletionAllowed,
    purge: ({ userId, now }) => requestAccountDeletion(deletion, { userId, now }),
    logger: console,
    limit: input.limit,
  });
}
