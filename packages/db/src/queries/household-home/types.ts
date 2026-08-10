import type {
  HouseholdAuthorizationGrant,
  HouseholdHomeComposition,
  HouseholdHomeRecord,
} from "@tendnote/domain";
import type { HouseholdRecordFacts } from "../households/authorization";

/**
 * One record a family wants on the home, paired with the facts policy needs to
 * decide whether this member may see it.
 *
 * The two travel together, and the service proves every candidate before it
 * composes anything. A family therefore cannot put a record on the home without
 * also stating what the record is — which is what stops a new domain from
 * quietly composing past the Household Authorization Proof (ADR 0219).
 */
export type HouseholdHomeCandidate = {
  facts: HouseholdRecordFacts;
  record: HouseholdHomeRecord;
};

/**
 * A domain family's contribution to the home.
 *
 * Loaders decide their own eligibility, timing, and section — that is the
 * domain's knowledge, not the home's. The home decides ordering, caps, and
 * whether the caller may see any of it.
 */
export type HouseholdHomeCandidateLoader = (input: {
  callerUserId: string;
  householdId: string;
  localDate: string;
  timeZone: string;
  now: Date;
  /**
   * The other active members' display names, read once for the whole
   * composition. Provenance is a name or nothing: a family that cannot resolve
   * one says "a household member" rather than exposing a user id.
   */
  memberNames: ReadonlyMap<string, string>;
}) => Promise<HouseholdHomeCandidate[]>;

/**
 * The composition read, bound to one currently admitted household.
 *
 * `household` is null whenever the caller has no active membership, and the
 * sections are then empty rather than absent — one shape for "you are not in a
 * household" and "your household is quiet" would be wrong, so the frame carries
 * the difference and the caller renders nothing at all without one.
 */
export type HouseholdHomeView = HouseholdHomeComposition & {
  household: { id: string; name: string } | null;
};

export type HouseholdHomeProver = (input: {
  callerUserId: string;
  operation: "view";
  records: readonly HouseholdRecordFacts[];
}) => Promise<HouseholdAuthorizationGrant[]>;
