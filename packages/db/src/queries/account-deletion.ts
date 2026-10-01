import type { AdmissionBlock } from "@tendnote/domain";
import { createDrizzleAccountDeletionStore } from "./account-deletion/drizzle-store";
import { accountDeletionAdmissionBlocks } from "./account-deletion/service";

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
