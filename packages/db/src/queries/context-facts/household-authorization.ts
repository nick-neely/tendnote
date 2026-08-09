import type {
  ContextFact,
  HouseholdAuthorizationGrant,
  HouseholdAuthorizationProof,
  HouseholdOperation,
  HouseholdRequestPurpose,
} from "@tendnote/domain";
import { evaluateHouseholdAuthorization, HouseholdRecordUnavailableError } from "@tendnote/domain";
import type { ContextFactHouseholdAccess } from "./types";

/**
 * The record family this seam proves. A proof for a Household Context Fact can
 * never be spent on a General Action or an Asset, because the family is part of
 * what {@link proofCovers} compares (ADR 0219).
 */
export const HOUSEHOLD_CONTEXT_RECORD_KIND = "household_context_fact";

/**
 * The facts about one Household Context Fact that policy is allowed to see.
 *
 * `creatorUserId` is passed as the record's owner and is deliberately *not* a
 * source of authority: Household Context is household-native, so the evaluator
 * records every active member's standing as `household_authority` and the
 * creator holds nothing extra. It is here because the audience gate needs an
 * owner field, and naming the creator is more honest than inventing one.
 */
export type HouseholdContextRecordFacts = Pick<
  ContextFact,
  "id" | "lifecycle" | "sensitivity" | "creatorUserId"
> & { householdId: string };

export function householdContextRecordFacts(fact: ContextFact): HouseholdContextRecordFacts | null {
  if (fact.subject.kind !== "household") return null;
  return {
    id: fact.id,
    lifecycle: fact.lifecycle,
    sensitivity: fact.sensitivity,
    creatorUserId: fact.creatorUserId,
    householdId: fact.subject.householdId,
  };
}

function authorizationSubject(record: HouseholdContextRecordFacts) {
  return {
    kind: HOUSEHOLD_CONTEXT_RECORD_KIND,
    id: record.id,
    ownerUserId: record.creatorUserId,
    scope: "household",
    householdId: record.householdId,
    ownership: "household_native",
    sensitivity: record.sensitivity,
  } as const;
}

type HouseholdContextProofRequest = {
  callerUserId: string;
  operation: HouseholdOperation;
  record: HouseholdContextRecordFacts;
  purpose?: HouseholdRequestPurpose;
};

/**
 * The Household Authorization Proof, bound to Household Context storage.
 *
 * Every call re-reads the caller's own active memberships, so a departure, a
 * removal, or a dissolution takes effect on the very next read rather than
 * whenever some cache expires — dissolution ends every membership, so a
 * dissolved household's facts stop being reachable through exactly the same gate
 * as a removed member's (ADR 0219).
 *
 * This family has no share registry and no `shared` scope: a household-owned
 * fact is visible to the whole household or it does not exist, so there is no
 * per-record audience to read and nothing a caller passes in can widen one.
 * `suggested` is not a lifecycle question here — whether a suggestion may be
 * seen is the review contract's rule, not a Household privacy one, and this
 * module deliberately does not answer for domains it knows nothing about.
 */
export function createHouseholdContextAuthorization(householdAccess?: ContextFactHouseholdAccess) {
  async function callerMemberships(callerUserId: string) {
    if (!householdAccess || !callerUserId) return [];
    const memberships = await householdAccess.listActiveHouseholdMembershipsForUser({
      userId: callerUserId,
    });
    return memberships.map((membership) => ({
      householdId: membership.householdId,
      userId: membership.userId,
    }));
  }

  async function proveHouseholdContextAccess(
    input: HouseholdContextProofRequest,
  ): Promise<HouseholdAuthorizationProof> {
    return evaluateHouseholdAuthorization({
      callerUserId: input.callerUserId,
      operation: input.operation,
      purpose: input.purpose,
      subject: authorizationSubject(input.record),
      callerActiveMemberships: await callerMemberships(input.callerUserId),
    });
  }

  return {
    proveHouseholdContextAccess,

    /** The proof-or-nothing form: one opaque refusal for every way this can fail. */
    async requireHouseholdContextAccess(
      input: HouseholdContextProofRequest,
    ): Promise<HouseholdAuthorizationGrant> {
      const proof = await proveHouseholdContextAccess(input);
      if (!proof.authorized) throw new HouseholdRecordUnavailableError();
      return proof;
    },

    /**
     * Proves a listing one fact at a time and keeps only what holds.
     *
     * An unproven fact leaves nothing behind — no row, no count, no gap — so a
     * restricted fact excluded from an ambient read is indistinguishable from a
     * household that never had one.
     */
    async proveHouseholdContextFacts(input: {
      callerUserId: string;
      operation: HouseholdOperation;
      facts: readonly ContextFact[];
      purpose?: HouseholdRequestPurpose;
    }): Promise<ContextFact[]> {
      const memberships = await callerMemberships(input.callerUserId);
      return input.facts.filter((fact) => {
        const record = householdContextRecordFacts(fact);
        if (!record) return false;
        return evaluateHouseholdAuthorization({
          callerUserId: input.callerUserId,
          operation: input.operation,
          purpose: input.purpose,
          subject: authorizationSubject(record),
          callerActiveMemberships: memberships,
        }).authorized;
      });
    },
  };
}
