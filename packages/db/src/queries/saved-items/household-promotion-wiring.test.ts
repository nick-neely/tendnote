import {
  HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE,
  HouseholdRecordUnavailableError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemoryGeneralActionStore } from "../general-actions/in-memory-store";
import { createAffectedGeneralActionLifecycle } from "../general-actions/mutation-lifecycle";
import type { GeneralActionLifecycleStore } from "../general-actions/types";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { householdNativeGeneralActionDestination } from "./household-destination";
import { createHouseholdSavedItemCollaboration } from "./household-native";
import { createInMemorySavedItemLifecycleStore } from "./in-memory-store";
import { createSavedItemLifecycle } from "./lifecycle";

/**
 * The Saved Item promotion seam wired the way production wires it, end to end.
 *
 * Every other promotion suite drives the destination through a fake, which is
 * right for the boundary's own contract but blind to the thing that actually
 * broke: the real General Action create resolves grounding, and a household
 * record's grounding belongs to whoever captured it rather than to whoever
 * presses promote. So this suite composes the real lifecycles over *one*
 * household store and *one* set of source records - the shape a single database
 * gives them in production - and lets a member who captured nothing promote.
 */
const ANA = "ana";
const BEN = "ben";
const OUTSIDER = "outsider";

async function seedStack() {
  const savedItems = createInMemorySavedItemLifecycleStore();
  const household = await seedHouseholdWithMembers(savedItems, {
    ownerUserId: ANA,
    members: [
      [ANA, "owner"],
      [BEN, "member"],
    ],
  });

  /**
   * The General Action store composed over the Saved Item store's household
   * memberships and source records, so both domains answer "who may see this
   * evidence" from the same facts. A second household store here would let the
   * two disagree, and disagreement is exactly what a wiring test must not
   * simulate away.
   */
  const actionStore: GeneralActionLifecycleStore = {
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(savedItems),
    getPerson: (input) => savedItems.getPerson(input),
    getSourceRecord: (input) => savedItems.getSourceRecord(input),
    getVisibleSourceRecord: (input) => savedItems.getVisibleSourceRecord(input),
  };
  const actions = createAffectedGeneralActionLifecycle(actionStore);
  const deps = {
    createHouseholdNativeGeneralAction: householdNativeGeneralActionDestination((input) =>
      actions.createGeneralAction(input),
    ),
  };

  return {
    savedItems,
    actionStore,
    actions,
    householdId: household.id,
    collaboration: createHouseholdSavedItemCollaboration(savedItems, deps),
    lifecycle: createSavedItemLifecycle(savedItems, deps),
  };
}

type Stack = Awaited<ReturnType<typeof seedStack>>;

/** Ana captures the household's note; its evidence is hers, scoped to the household. */
function anaCaptures(stack: Stack, title = "Boiler service number") {
  return stack.collaboration.createHouseholdSavedItem({
    actorUserId: ANA,
    householdId: stack.householdId,
    kind: "note",
    title,
  });
}

describe("promoting a household Saved Item somebody else captured", () => {
  let stack: Stack;
  beforeEach(async () => {
    stack = await seedStack();
  });

  it("lets the member who captured nothing hand it to the household's Actions", async () => {
    const item = await anaCaptures(stack);

    const promotion = await stack.collaboration.promoteHouseholdSavedItem({
      actorUserId: BEN,
      savedItemId: item.id,
      expectedVersion: item.version,
      idempotencyKey: "boiler-promotion",
    });

    // The destination is the household's, not Ben's, even though Ben pressed it
    // and Ana's is the evidence underneath.
    const [outcome] = await stack.savedItems.listSavedItemOutcomes({ savedItemId: item.id });
    const action = await stack.actionStore.getGeneralAction({
      ownerUserId: BEN,
      generalActionId: outcome?.destinationRecordId as string,
    });
    expect(action).toMatchObject({
      ownership: "household_native",
      scope: "household",
      householdId: stack.householdId,
      createdByUserId: BEN,
      // The grounding survived the hand-off rather than being dropped to null to
      // get past an owner-keyed read.
      sourceRecordId: item.sourceRecordId,
    });
    expect(promotion.savedItem).toMatchObject({
      status: "archived",
      resolutionReason: "Promoted to a household Action.",
      ownership: "household_native",
    });
  });

  it("gives an owner's own Saved Item to the household without transferring the item", async () => {
    const mine = await stack.lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Book the boiler service",
      scope: "household",
      householdId: stack.householdId,
    });

    const promotion = await stack.lifecycle.promoteSavedItemToGeneralAction({
      actorUserId: ANA,
      savedItemId: mine.id,
      authority: "explicit",
      idempotencyKey: "give-to-the-household",
      destination: "household_native",
    });

    const [outcome] = await stack.savedItems.listSavedItemOutcomes({ savedItemId: mine.id });
    await expect(
      stack.actionStore.getGeneralAction({
        ownerUserId: ANA,
        generalActionId: outcome?.destinationRecordId as string,
      }),
    ).resolves.toMatchObject({ ownership: "household_native", scope: "household" });
    // Only the Action went. The Saved Item is still Ana's, archived as resolved.
    expect(promotion.savedItem).toMatchObject({
      ownership: "member_owned",
      ownerUserId: ANA,
      status: "archived",
      resolutionReason: "Promoted to a household Action.",
    });
  });

  it("refuses opaquely when the grounding is not the household's to stand on", async () => {
    const strangersEvidence = await stack.savedItems.createSourceRecord({
      ownerUserId: OUTSIDER,
      content: "Someone else's note",
      scope: "private",
    });

    const refusal = await stack.actions
      .createGeneralAction({
        ownerUserId: BEN,
        ownership: "household_native",
        scope: "household",
        householdId: stack.householdId,
        title: "Chase the boiler quote",
        sourceRecordId: strangersEvidence.id,
      })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(HouseholdRecordUnavailableError);
    // The same sentence a refused proof produces: it must not say whether that
    // evidence exists (ADR 0219).
    expect((refusal as Error).message).toBe(HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE);
  });

  it("keeps a member-owned Action's grounding owner-scoped, household or not", async () => {
    const ansEvidence = await stack.savedItems.createSourceRecord({
      ownerUserId: ANA,
      content: "Ana's household note",
      scope: "household",
      householdId: stack.householdId,
    });

    // Ben can see this evidence - it is the household's - and that still does
    // not make it grounding he may file his own record on.
    await expect(
      stack.actions.createGeneralAction({
        ownerUserId: BEN,
        title: "My own errand",
        sourceRecordId: ansEvidence.id,
      }),
    ).rejects.toThrow("Source record not found.");

    // His own evidence resolves exactly as it always did.
    const bensEvidence = await stack.savedItems.createSourceRecord({
      ownerUserId: BEN,
      content: "Ben's note",
      scope: "private",
    });
    const mine = await stack.actions.createGeneralAction({
      ownerUserId: BEN,
      title: "My own errand",
      sourceRecordId: bensEvidence.id,
    });
    expect(mine.result).toMatchObject({
      ownership: "member_owned",
      ownerUserId: BEN,
      sourceRecordId: bensEvidence.id,
    });
  });
});
