import type { GeneralAction, GeneralActionAuthorityOperation } from "@tendnote/domain";
import {
  assertGeneralActionOperationForm,
  HouseholdRecordUnavailableError,
  householdOperationForGeneralAction,
} from "@tendnote/domain";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import type { GeneralActionAuthorityStore } from "./types";

/**
 * The one place a General Action's authority is decided.
 *
 * Every lifecycle path funnels through here rather than comparing
 * `action.ownerUserId` to the actor, because the two ownership forms answer the
 * same operation differently and a comparison written beside a mutation cannot
 * tell them apart: a member-owned Action at `household` scope and a
 * household-native one are the same row shape to the audience rule. The proof
 * reads the actor's memberships and the record's audience fresh on every call
 * (ADR 0219), so a member who left between a page render and a button press is
 * refused here.
 *
 * Two operations are refused before the proof is asked, because they are
 * questions about the record family rather than about the caller — see
 * {@link assertGeneralActionOperationForm}.
 */
export function createGeneralActionAuthority(store: GeneralActionAuthorityStore) {
  const prover = createHouseholdAuthorizationProver(store);

  return {
    /**
     * Proves one operation on one loaded Action, or throws.
     *
     * Both failure modes are deliberate and different. A form refusal
     * ({@link assertGeneralActionOperationForm}) is a curated sentence about the
     * kind of record, safe to show because it discloses nothing the caller
     * cannot already see. A proof refusal is the single opaque
     * {@link HouseholdRecordUnavailableError}, which is what "you may not",
     * "it was deleted", and "you were removed from that household" must all look
     * like from outside.
     */
    async requireGeneralActionAuthority(input: {
      actorUserId: string;
      action: GeneralAction;
      operation: GeneralActionAuthorityOperation;
    }) {
      assertGeneralActionOperationForm({
        operation: input.operation,
        ownership: input.action.ownership,
      });

      return prover.requireRecordAccess({
        callerUserId: input.actorUserId,
        operation: householdOperationForGeneralAction(input.operation),
        record: {
          kind: "general_action",
          id: input.action.id,
          ownerUserId: input.action.ownerUserId,
          scope: input.action.scope,
          householdId: input.action.householdId,
          ownership: input.action.ownership,
        },
      });
    },
  };
}
