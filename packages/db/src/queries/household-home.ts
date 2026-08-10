import { listBriefSchedulesForOwner } from "./brief-schedules";
import { listActiveGeneralActions } from "./general-actions";
import { loadHouseholdActionCandidates } from "./household-home/candidate-loaders/actions";
import { createHouseholdHomeService } from "./household-home/service";
import {
  getAdmittedHouseholdForUser,
  listShareableHouseholdMembersForUser,
  proveVisibleHouseholdRecords,
} from "./households";

export type { HouseholdHomeActionDeps } from "./household-home/candidate-loaders/actions";
export { loadHouseholdActionCandidates } from "./household-home/candidate-loaders/actions";
export {
  createHouseholdHomeService,
  type HouseholdHomeServiceDeps,
} from "./household-home/service";
export type * from "./household-home/types";

/**
 * The Household home read.
 *
 * Composed rather than cached. The surface is online-required by decision: a
 * shared read whose authorization can end mid-session must never be served from
 * a store that outlives the membership behind it, so this reads authoritative
 * state on every request and a member who has left sees the destination
 * disappear rather than a stale copy of what they used to be able to see.
 *
 * The launch composition is Actions and Routines, the first domain to earn a
 * full Phase Eight collaboration contract. A later family joins by adding its
 * loader to this array; the caps, ordering, provenance, and Household
 * Authorization Proof are already common to every family and are not the new
 * domain's to re-decide.
 */
const defaultHouseholdHomeService = createHouseholdHomeService({
  readAdmittedHousehold: ({ callerUserId }) =>
    getAdmittedHouseholdForUser({ userId: callerUserId }),
  listMemberNames: ({ callerUserId }) =>
    listShareableHouseholdMembersForUser({ userId: callerUserId }),
  loadCandidateFamilies: [
    (input) =>
      loadHouseholdActionCandidates(
        {
          listVisibleActions: ({ callerUserId, limit }) =>
            listActiveGeneralActions({ ownerUserId: callerUserId, limit }),
        },
        input,
      ),
  ],
  proveRecords: (input) => proveVisibleHouseholdRecords(input),
  /**
   * The member's own opt-in, read fresh on every composition.
   *
   * Any enabled briefing carrying the flag counts, because the member opted into
   * a Check-in rather than into one cadence's version of one. A member with no
   * briefing schedules at all has never opted in, and reads as `false` without a
   * special case.
   */
  readCheckinOptIn: async ({ callerUserId }) => {
    const schedules = await listBriefSchedulesForOwner({ ownerUserId: callerUserId });
    return schedules.some((schedule) => schedule.householdCheckinEnabled);
  },
});

export function getHouseholdHome(input: {
  callerUserId: string;
  localDate: string;
  timeZone?: string;
  now?: Date;
}) {
  return defaultHouseholdHomeService.getHouseholdHome(input);
}

/**
 * One member's private Household Check-in.
 *
 * Composed on every read for the same reason the home is: authorization can end
 * mid-session, and a Check-in served from a store that outlives the membership
 * behind it is a shared record delivered to someone who has left. Every surface
 * that shows a Check-in — the private briefing, the Household destination, an Eve
 * turn — calls this again rather than reusing what it was handed.
 */
export function getHouseholdCheckin(input: {
  callerUserId: string;
  localDate: string;
  timeZone?: string;
  now?: Date;
}) {
  return defaultHouseholdHomeService.getHouseholdCheckin(input);
}
