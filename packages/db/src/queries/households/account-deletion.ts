import {
  accountDeletionHouseholdTransition,
  type HouseholdRoster,
  HouseholdValidationError,
} from "@tendnote/domain";

export type AccountDeletionHouseholdOverview = {
  members: Array<{ userId: string; role: "owner" | "member" }>;
};

/**
 * Early product-facing refusal for an account deletion that would strand a
 * multi-member Household without an Owner.
 *
 * This read is advisory. The database trigger locks the workspace, re-evaluates
 * the same rule, performs sole-member dissolution, and deletes the user in one
 * transaction. Nothing mutates here, so a later auth failure cannot leave a
 * live account departed or a Household dissolved by half an operation.
 */
export function createAccountDeletionHouseholdGuard(
  getOverview: (input: { userId: string }) => Promise<AccountDeletionHouseholdOverview | null>,
) {
  return async function assertHouseholdAccountDeletionAllowed(input: { userId: string }) {
    const overview = await getOverview(input);
    if (!overview) return;

    const roster: HouseholdRoster = overview.members.map((member) => ({
      ...member,
      status: "active",
    }));
    const transition = accountDeletionHouseholdTransition({ roster, userId: input.userId });
    if (typeof transition === "object") {
      throw new HouseholdValidationError(transition.refused);
    }
  };
}
