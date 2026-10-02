import {
  type AccountDeletionDependencies,
  blobRecoveryJournal,
  createDrizzleAccountDeletionStore,
  requestAccountDeletion,
} from "@tendnote/db/queries/account-deletion";
import { assertHouseholdAccountDeletionAllowed } from "@tendnote/db/queries/households";
import { APIError } from "better-auth/api";

type RevokeSessions = AccountDeletionDependencies["revokeSessions"];

/** Self-service deletion's production wiring, shared by the request and the recovery cron. */
export function accountDeletionDependencies(
  revokeSessions: RevokeSessions,
): AccountDeletionDependencies {
  return {
    store: createDrizzleAccountDeletionStore(),
    journal: blobRecoveryJournal,
    revokeSessions,
    logger: console,
  };
}

/**
 * Better Auth's `deleteUser.beforeDelete`, which takes the deletion over.
 *
 * Better Auth keeps what it is good at - re-authenticating the request - and
 * this hook does the deletion itself in the Recovery Journal's order (#616).
 * When it completes, the account row is already gone and Better Auth's own
 * delete finds nothing left to remove. When only the intent committed, Better
 * Auth must not delete anything, so the request ends here as 202 Accepted: the
 * account is closed, and the recovery cron finishes the deletion. Ending
 * here also skips Better Auth's cookie clearing; the cookie is inert because
 * its session is already revoked, so the client should simply sign out.
 */
export function createAccountDeletionHook(input: {
  dependencies: () => AccountDeletionDependencies;
  assertAllowed?: (input: { userId: string }) => Promise<void>;
}) {
  const assertAllowed = input.assertAllowed ?? assertHouseholdAccountDeletionAllowed;

  return async function beforeDelete(deletingUser: { id: string }) {
    // Refused before the intent, so a stranded Household leaves the account open.
    await assertAllowed({ userId: deletingUser.id });
    const { status } = await requestAccountDeletion(input.dependencies(), {
      userId: deletingUser.id,
    });
    if (status === "pending") {
      throw new APIError("ACCEPTED", { success: true, message: "Account deletion accepted" });
    }
  };
}
