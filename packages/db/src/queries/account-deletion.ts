import { type AdmissionBlock, DELETION_INTENT_ALERT_AFTER_HOURS } from "@tendnote/domain";
import { lte } from "drizzle-orm";
import { getDb } from "../client";
import { accountDeletionIntents } from "../schema";
import { createDrizzleAccountDeletionStore } from "./account-deletion/drizzle-store";
import { accountDeletionAdmissionBlocks } from "./account-deletion/service";

export { blobRecoveryJournal } from "./account-deletion/blob-journal";
export { createDrizzleAccountDeletionStore } from "./account-deletion/drizzle-store";
export {
  type AccountDeletionDependencies,
  type AccountDeletionSweepResult,
  requestAccountDeletion,
  runAccountDeletionSweep,
} from "./account-deletion/service";

/** The admission blocks a pending deletion raises for the account, read from its intent. */
export async function listAccountDeletionAdmissionBlocks(input: {
  userId: string;
}): Promise<AdmissionBlock[]> {
  return accountDeletionAdmissionBlocks(
    await createDrizzleAccountDeletionStore().findIntent(input),
  );
}

/**
 * Whether any deletion intent is still incomplete twenty-four hours after it
 * was committed, the operator alert's condition (#648). An intent goes with its
 * account, so every intent row is an incomplete deletion. Read directly rather
 * than from a sweep, which visits only some intents each pass.
 */
export async function hasStuckAccountDeletionIntent(input: { now: Date }): Promise<boolean> {
  const cutoff = new Date(input.now.getTime() - DELETION_INTENT_ALERT_AFTER_HOURS * 60 * 60 * 1000);
  const [stuck] = await getDb()
    .select({ userId: accountDeletionIntents.userId })
    .from(accountDeletionIntents)
    .where(lte(accountDeletionIntents.requestedAt, cutoff))
    .limit(1);
  return Boolean(stuck);
}
