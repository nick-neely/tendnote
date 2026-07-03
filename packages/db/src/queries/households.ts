import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { createHouseholdLifecycle } from "./households/lifecycle";
import type {
  AcceptHouseholdInviteInput,
  CreateHouseholdInput,
  InviteHouseholdMemberInput,
  RemoveHouseholdMemberInput,
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
