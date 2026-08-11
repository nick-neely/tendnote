import type {
  GovernanceAvailability,
  HouseholdMemberSummary,
  HouseholdOverview,
} from "@tendnote/domain/household-overview";

/**
 * Overview fixtures for the Household DOM suites.
 *
 * The Overview carries a governance answer for every control on the screen, and
 * most tests care about exactly one of them. These helpers supply the rest as
 * the shape a real read would have — a member with no moves offered, a sole
 * owner who cannot leave — so a test states only the fact it is about, and a new
 * field added to the domain type lands in one place rather than in every suite.
 */
const NONE: GovernanceAvailability = { available: false, blockedReason: null };

export function member(
  overrides: Partial<HouseholdMemberSummary> & Pick<HouseholdMemberSummary, "userId">,
): HouseholdMemberSummary {
  return {
    name: "Sam",
    email: "sam@example.com",
    role: "member",
    isViewer: true,
    awaitingOwnerReply: false,
    promote: NONE,
    remove: NONE,
    ...overrides,
  };
}

type GovernanceFields = Pick<
  HouseholdOverview,
  "ownerOffer" | "departure" | "stepDown" | "dissolution"
>;

export function governanceDefaults(input: {
  viewerRole: "owner" | "member";
  /** A sole owner is held back from leaving, which is a common fixture state. */
  soleMember?: boolean;
}): GovernanceFields {
  const owner = input.viewerRole === "owner";
  return {
    ownerOffer: null,
    departure: owner
      ? {
          available: false,
          blockedReason: input.soleMember
            ? "You're the only person here, so there's nobody to hand the household to. Ending it is how you close it."
            : "You're the only owner. Ask someone here to become an owner too — once they accept, you can leave.",
        }
      : { available: true, blockedReason: null },
    stepDown: owner
      ? {
          available: false,
          blockedReason:
            "You're the only owner. Someone else here needs to accept co-ownership first.",
        }
      : NONE,
    dissolution: {
      available: owner,
      // A member is told the rule even though no control follows from it.
      blockedReason: owner ? null : "Only an owner can end a household.",
      required: owner ? 1 : 1,
      confirmed: 0,
      awaitingUserIds: [],
      unanimous: false,
      viewerHasConfirmed: false,
    },
  };
}
