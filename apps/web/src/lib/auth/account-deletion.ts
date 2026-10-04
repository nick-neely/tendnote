import {
  type AccountDeletionDependencies,
  blobRecoveryJournal,
  createDrizzleAccountDeletionStore,
  requestAccountDeletion,
} from "@tendnote/db/queries/account-deletion";
import { assertHouseholdAccountDeletionAllowed } from "@tendnote/db/queries/households";
import { getStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { HouseholdValidationError } from "@tendnote/domain";
import { APIError } from "better-auth/api";
import { cancelSubscriptionsForDeletion } from "@/lib/billing/deletion-cancellation";

type RevokeSessions = AccountDeletionDependencies["revokeSessions"];

/** Self-service deletion's production wiring, shared by the request and the recovery cron. */
export function accountDeletionDependencies(
  revokeSessions: RevokeSessions,
): AccountDeletionDependencies {
  return {
    store: createDrizzleAccountDeletionStore(),
    journal: blobRecoveryJournal,
    revokeSessions,
    cancelSubscriptions: async (account) => {
      // Loaded on use: the Stripe client is server-only, and self-hosted
      // accounts never hold a Stripe customer, so never reach it.
      const { configuredStripe } = await import("@/lib/billing/paid-access-projection");
      await cancelSubscriptionsForDeletion(
        { stripe: configuredStripe, getStripeCustomerId },
        account,
      );
    },
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
    // The refusal says what to do next, so it reaches the deletion screen as a
    // 400 carrying that text rather than Better Auth's opaque server error.
    try {
      await assertAllowed({ userId: deletingUser.id });
    } catch (error) {
      if (error instanceof HouseholdValidationError) {
        throw new APIError("BAD_REQUEST", { code: "HOUSEHOLD_REFUSED", message: error.message });
      }
      throw error;
    }
    const { status } = await requestAccountDeletion(input.dependencies(), {
      userId: deletingUser.id,
    });
    if (status === "pending") {
      throw new APIError("ACCEPTED", { success: true, message: "Account deletion accepted" });
    }
  };
}
