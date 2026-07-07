import type { HouseholdRole, HouseholdWorkspace } from "@tendnote/domain";
import type { HouseholdStore } from "./types";

type HouseholdSeedStore = Pick<
  HouseholdStore,
  "createHouseholdWorkspace" | "createHouseholdMembership"
>;

/**
 * Test fixture: create a private household workspace and add the given members, all as
 * active from a fixed date. The membership shape (owner-invited, active, June-1 accept)
 * is identical across the General Action lifecycle, review, and extraction suites, so it
 * lives here rather than being re-seeded inline in each `it`.
 */
export async function seedHouseholdWithMembers(
  store: HouseholdSeedStore,
  options: {
    ownerUserId: string;
    name?: string;
    members: ReadonlyArray<readonly [string, HouseholdRole]>;
  },
): Promise<HouseholdWorkspace> {
  const household = await store.createHouseholdWorkspace({
    ownerUserId: options.ownerUserId,
    name: options.name ?? "Home",
    defaultScope: "private",
  });

  for (const [userId, role] of options.members) {
    await store.createHouseholdMembership({
      householdId: household.id,
      userId,
      invitedByUserId: options.ownerUserId,
      role,
      status: "active",
      invitedAt: new Date("2026-06-01T00:00:00Z"),
      acceptedAt: new Date("2026-06-01T00:00:00Z"),
      removedAt: null,
    });
  }

  return household;
}

/**
 * Test fixture: mark an active household member as removed (as of now, or a supplied date).
 * The get-membership-then-patch-to-removed pair recurs across the fail-closed visibility
 * cases, so it is shared here to keep the removal shape identical.
 */
export async function removeHouseholdMember(
  store: Pick<HouseholdStore, "getHouseholdMembership" | "updateHouseholdMembership">,
  input: { householdId: string; userId: string; removedAt?: Date },
) {
  const membership = await store.getHouseholdMembership({
    householdId: input.householdId,
    userId: input.userId,
  });

  return store.updateHouseholdMembership({
    membershipId: membership?.id as string,
    patch: { status: "removed", removedAt: input.removedAt ?? new Date() },
  });
}
