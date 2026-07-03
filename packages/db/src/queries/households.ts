import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../client";
import { householdMemberships, user } from "../schema";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { createHouseholdLifecycle } from "./households/lifecycle";
import type {
  AcceptHouseholdInviteInput,
  CanViewHouseholdRecordInput,
  CreateHouseholdInput,
  InviteHouseholdMemberInput,
  RemoveHouseholdMemberInput,
  ShareHouseholdRecordInput,
} from "./households/types";

export { createDrizzleHouseholdStore } from "./households/drizzle-store";
export { createInMemoryHouseholdStore } from "./households/in-memory-store";
export { createHouseholdLifecycle } from "./households/lifecycle";
export type * from "./households/types";

const defaultHouseholdStore = createDrizzleHouseholdStore();
const defaultHouseholdLifecycle = createHouseholdLifecycle(defaultHouseholdStore);

export function createHousehold(input: CreateHouseholdInput) {
  return defaultHouseholdLifecycle.createHousehold(input);
}

export function inviteHouseholdMember(input: InviteHouseholdMemberInput) {
  return defaultHouseholdLifecycle.inviteMember(input);
}

export function acceptHouseholdInvite(input: AcceptHouseholdInviteInput) {
  return defaultHouseholdLifecycle.acceptInvite(input);
}

export function removeHouseholdMember(input: RemoveHouseholdMemberInput) {
  return defaultHouseholdLifecycle.removeMember(input);
}

export function shareHouseholdRecordWithSelectedMembers(input: ShareHouseholdRecordInput) {
  return defaultHouseholdLifecycle.shareRecordWithSelectedMembers(input);
}

export function canViewHouseholdRecord(input: CanViewHouseholdRecordInput) {
  return defaultHouseholdLifecycle.canViewHouseholdRecord(input);
}

export function listActiveHouseholdMembershipsForUser(input: { userId: string }) {
  return defaultHouseholdLifecycle.listActiveMembershipsForUser(input);
}

export async function listShareableHouseholdMembersForUser(input: { userId: string }) {
  const memberships = await defaultHouseholdLifecycle.listActiveMembershipsForUser(input);
  const householdId = memberships[0]?.householdId;
  if (!householdId) {
    return [];
  }

  return getDb()
    .select({
      householdId: householdMemberships.householdId,
      userId: householdMemberships.userId,
      name: user.name,
      email: user.email,
    })
    .from(householdMemberships)
    .innerJoin(user, eq(householdMemberships.userId, user.id))
    .where(
      and(
        eq(householdMemberships.householdId, householdId),
        eq(householdMemberships.status, "active"),
        ne(householdMemberships.userId, input.userId),
      ),
    );
}
