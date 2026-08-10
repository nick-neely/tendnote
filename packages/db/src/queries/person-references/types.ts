import type { PersonReference, PersonReferenceRecordKind } from "@tendnote/domain";
import type { HouseholdRecordFacts } from "../households/authorization";
import type { HouseholdStore } from "../households/types";

/**
 * The containing record, described by the domain that owns it.
 *
 * Person References deliberately do not know how to read their host: an Event
 * Plan, a Gift Plan, and a Saved Item are different tables with different
 * lifecycle rules, and a seam that tried to read all of them would end up
 * reimplementing each domain's authority. The host domain supplies the facts,
 * the Household Authorization Proof decides, and this module only ever handles
 * labels (ADR 0219).
 */
export type PersonReferenceHost = HouseholdRecordFacts & {
  kind: PersonReferenceRecordKind;
  /** Required: a reference is household-native, so a host with no household has none. */
  householdId: string;
};

export type PersonReferenceStore = Pick<
  HouseholdStore,
  | "listActiveHouseholdMembershipsForUser"
  | "listHouseholdRecordSharesForRecords"
  | "createAuditLogEntry"
> & {
  createPersonReference: (input: {
    householdId: string;
    recordKind: PersonReferenceRecordKind;
    recordId: string;
    label: string;
    createdByUserId: string;
  }) => Promise<PersonReference>;
  /**
   * Lists the references on **one** record.
   *
   * There is no list-by-household, list-by-label, or list-by-creator method,
   * and that is the point: every read is anchored to a record whose access the
   * caller has already had to prove, so there is no path that returns names
   * across the workspace (ADR 0218).
   */
  listPersonReferencesForRecord: (input: {
    recordKind: PersonReferenceRecordKind;
    recordId: string;
  }) => Promise<PersonReference[]>;
  /** Scoped by record as well as id, so an id alone cannot reach another record's row. */
  deletePersonReference: (input: {
    recordKind: PersonReferenceRecordKind;
    recordId: string;
    personReferenceId: string;
  }) => Promise<void>;
};
