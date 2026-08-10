import type { MutationOutcome } from "../affected-scopes";
import type { CreateActiveGeneralActionInput } from "../general-actions/types";
import type { SavedItemLifecycleDeps } from "./types";

/** The General Action write this adapter is layered over, injected so it can be composed or faked. */
type CreateGeneralAction = (
  input: CreateActiveGeneralActionInput,
) => Promise<MutationOutcome<{ id: string }>>;

/**
 * The one mapping from "promote this Saved Item into the household's Actions" to
 * the General Action create that produces a workspace-owned record.
 *
 * A named adapter rather than an inline lambda at each composition site because
 * there are three of them - the household-native promotion, the member-owned
 * **Give to the household** hand-off, and the wiring test that proves them - and
 * the whole risk this seam carries is that one of them maps it differently. The
 * two fields that decide the ownership form (`ownership` and `scope`) are set
 * here, once, and no caller gets to choose them.
 *
 * `createdByUserId` becomes the new row's `ownerUserId`, which on a
 * household-native record is a storage key and creator provenance and confers no
 * authority over it (ADR 0214). That is why any active member may press promote
 * and the result is still the household's.
 */
export function householdNativeGeneralActionDestination(
  createGeneralAction: CreateGeneralAction,
): NonNullable<SavedItemLifecycleDeps["createHouseholdNativeGeneralAction"]> {
  return (input) =>
    createGeneralAction({
      id: input.id,
      ownerUserId: input.createdByUserId,
      ownership: "household_native",
      scope: "household",
      householdId: input.householdId,
      title: input.title,
      notes: input.notes,
      // Grounding travels with the promotion rather than being re-derived. It is
      // resolved by household visibility on the far side, because the evidence
      // behind a household record belongs to whoever captured it and the member
      // promoting it is usually somebody else.
      sourceRecordId: input.sourceRecordId,
    });
}
