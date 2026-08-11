import type { ContextFact, HouseholdOperation, HouseholdRequestPurpose } from "@tendnote/domain";
import { createHouseholdProofSeam } from "../households/authorization";
import type { ContextFactHouseholdAccess } from "./types";

/**
 * The record family this seam proves. A proof for a Household Context Fact can
 * never be spent on a General Action or an Asset, because the family is part of
 * what `proofCovers` compares (ADR 0219).
 */
const HOUSEHOLD_CONTEXT_RECORD_KIND = "household_context_fact";

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

/**
 * The Household Authorization Proof, bound to Household Context storage.
 *
 * The seam's machinery — reading the caller's memberships at the moment of the
 * call, the single opaque refusal, dropping rather than marking an unproven
 * record — comes from `createHouseholdProofSeam`, so an ADR 0219 contract change
 * reaches this family without anyone remembering it exists. All this file
 * supplies is what is genuinely its own: where the memberships come from, and
 * how a stored Context Fact is described to policy.
 *
 * That description has no audience read, and that is the substantive difference
 * from the scoped-record family. A household-owned fact is visible to the whole
 * household or it does not exist, so there is no `shared` scope, no share
 * registry row, and nothing a caller passes in that could widen one. Membership
 * is the entire audience question, and dissolution ends every membership — so a
 * dissolved household's facts stop being reachable through exactly the same gate
 * as a removed member's.
 *
 * `suggested` is deliberately not treated as a lifecycle refusal here: whether a
 * suggestion may be seen is the review contract's rule, not a Household privacy
 * one, and this module does not answer for domains it knows nothing about.
 */
export function createHouseholdContextAuthorization(householdAccess?: ContextFactHouseholdAccess) {
  const seam = createHouseholdProofSeam<HouseholdContextRecordFacts, void>({
    readCallerMemberships: async (callerUserId) => {
      // No skip: every fact in this family is household-scoped, so the
      // membership read is never avoidable and pretending otherwise would only
      // add a branch that can never be taken.
      if (!householdAccess || !callerUserId) return [];
      const memberships = await householdAccess.listActiveHouseholdMembershipsForUser({
        userId: callerUserId,
      });
      return memberships.map((membership) => ({
        householdId: membership.householdId,
        userId: membership.userId,
      }));
    },
    readSubjectContext: async () => undefined,
    toSubject: (record) => ({
      kind: HOUSEHOLD_CONTEXT_RECORD_KIND,
      id: record.id,
      ownerUserId: record.creatorUserId,
      scope: "household",
      householdId: record.householdId,
      ownership: "household_native",
      sensitivity: record.sensitivity,
    }),
  });

  return {
    proveHouseholdContextAccess: seam.proveRecord,
    requireHouseholdContextAccess: seam.requireRecord,

    /**
     * Proves a listing and keeps only the facts that hold.
     *
     * The grants come back keyed by subject id, which is the fact id, so this
     * maps them back to the records the caller asked about. A refused fact
     * leaves nothing behind — no row, no count, no gap — so a restricted fact
     * excluded from an ambient read is indistinguishable from a household that
     * never had one.
     */
    async proveHouseholdContextFacts(input: {
      callerUserId: string;
      operation: HouseholdOperation;
      facts: readonly ContextFact[];
      purpose?: HouseholdRequestPurpose;
    }): Promise<ContextFact[]> {
      const byId = new Map<string, ContextFact>();
      const records: HouseholdContextRecordFacts[] = [];
      for (const fact of input.facts) {
        const record = householdContextRecordFacts(fact);
        if (!record) continue;
        byId.set(fact.id, fact);
        records.push(record);
      }

      const grants = await seam.proveRecords({
        callerUserId: input.callerUserId,
        operation: input.operation,
        purpose: input.purpose,
        records,
      });

      return grants.flatMap((grant) => {
        const fact = byId.get(grant.subjectId);
        return fact ? [fact] : [];
      });
    },
  };
}
