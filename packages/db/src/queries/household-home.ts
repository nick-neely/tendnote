import { getAccessProfile } from "./access-profiles";
import { listActiveGeneralActions } from "./general-actions";
import { listGiftPlans } from "./gift-plans";
import { loadHouseholdActionCandidates } from "./household-home/candidate-loaders/actions";
import { loadHouseholdCheckinGiftPlanCandidates } from "./household-home/candidate-loaders/gift-plans";
import { createHouseholdHomeService } from "./household-home/service";
import {
  getAdmittedHouseholdForUser,
  listShareableHouseholdMembersForUser,
  proveVisibleHouseholdRecords,
} from "./households";

export type { HouseholdHomeActionDeps } from "./household-home/candidate-loaders/actions";
export { loadHouseholdActionCandidates } from "./household-home/candidate-loaders/actions";
export type { HouseholdCheckinGiftPlanDeps } from "./household-home/candidate-loaders/gift-plans";
export { loadHouseholdCheckinGiftPlanCandidates } from "./household-home/candidate-loaders/gift-plans";
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
  /**
   * The families only the Check-in composes.
   *
   * Gift Plans reach it through the seam's own proved read, which refuses the
   * Surprise Subject in SQL and again at the proof before this loader sees a
   * row — and the composition proves each candidate a third time on facts read
   * at that moment. Three gates rather than one is the point on the only surface
   * that delivers a shared record into a member's private space.
   */
  loadCheckinOnlyFamilies: [
    (input) =>
      loadHouseholdCheckinGiftPlanCandidates(
        {
          listVisibleGiftPlans: ({ callerUserId, limit }) => listGiftPlans({ callerUserId, limit }),
        },
        input,
      ),
  ],
  proveRecords: (input) => proveVisibleHouseholdRecords(input),
  /**
   * The member's own opt-in, read fresh on every composition.
   *
   * From the access profile, which every admitted member has, rather than from a
   * briefing row that may not exist yet — a member who has never had a brief
   * generated must still be able to ask for a Check-in and get one.
   *
   * This *read* defaults to `false` and never throws, which is the opposite of
   * its setter and deliberately so. The two are asked different questions: "has
   * this member opted in?" has an honest conservative answer for someone with no
   * profile, while "turn this member's check-in on" has none — succeeding against
   * a row that is not there is the silent no-op that shipped once already. The
   * throwing half is `setHouseholdCheckinEnabled` in
   * `queries/access-profiles/queries.ts`.
   */
  readCheckinOptIn: async ({ callerUserId }) =>
    (await getAccessProfile({ userId: callerUserId }))?.householdCheckinEnabled ?? false,
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
