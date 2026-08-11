import { createHash } from "node:crypto";
import {
  assertSavedItemEditable,
  SavedItemUnavailableDestinationError,
  SavedItemValidationError,
} from "@tendnote/domain";
import { hydrateSavedItem, type MemberOwnedSavedItem, requireOwnedSavedItem } from "./context";
import type { SavedItemLifecycleDeps, SavedItemLifecycleStore } from "./types";

export type PromoteSavedItemInput = {
  actorUserId: string;
  savedItemId: string;
  authority: "explicit" | "inferred";
  idempotencyKey: string;
  title?: string;
  /**
   * Which ownership form the new Action takes.
   *
   * `member_owned` (the default) keeps the destination with the owner who
   * promoted it, carrying only the audience they already chose. `household_native`
   * is the explicit **Make household Action**: a new workspace-owned Action, with
   * this Saved Item archived as resolved beside it. It is a separate, confirmed
   * decision rather than something inferred from the item being household-scoped
   * - an Action that stays behind after you leave is not a thing to end up with
   * by accident, and there is no claim-back path once it is made
   * (`docs/phase-8/household-saved-items.md`).
   */
  destination?: "member_owned" | "household_native";
};

/**
 * The destination id one idempotency key always produces, so a retried promotion
 * resumes instead of creating a second Action. Shared with the household-native
 * boundary so both ownership forms derive it the same way.
 */
export function stablePromotionDestinationId(idempotencyKey: string): string {
  const hex = createHash("sha256").update(`saved-item-promotion:${idempotencyKey}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function completePromotion(
  store: SavedItemLifecycleStore,
  input: PromoteSavedItemInput,
  destination: { destinationKind: "general_action"; destinationRecordId: string },
  resumed: boolean,
) {
  const current = await requireOwnedSavedItem(store, input);
  const completed =
    current.status === "archived"
      ? current
      : await store.updateSavedItem({
          ownerUserId: current.ownerUserId,
          savedItemId: current.id,
          patch: {
            status: "archived",
            resolvedAt: new Date(),
            resolutionReason:
              input.destination === "household_native"
                ? "Promoted to a household Action."
                : "Promoted to General Action.",
            lastActorUserId: input.actorUserId,
          },
        });
  const priorEvents = await store.listSavedItemEvents({
    ownerUserId: completed.ownerUserId,
    savedItemId: completed.id,
  });
  const alreadyAudited = priorEvents.some(
    (event) =>
      event.kind === "promoted" && event.detailJson.idempotencyKey === input.idempotencyKey,
  );
  if (!alreadyAudited) {
    await store.createSavedItemEvent({
      savedItemId: completed.id,
      ownerUserId: completed.ownerUserId,
      kind: "promoted",
      actorUserId: input.actorUserId,
      detailJson: { ...destination, idempotencyKey: input.idempotencyKey, resumed },
    });
  }
  return hydrateSavedItem(store, completed);
}

/** The default: the owner's own Action, carrying only the audience already chosen. */
async function createOwnDestination(
  store: SavedItemLifecycleStore,
  deps: SavedItemLifecycleDeps,
  current: MemberOwnedSavedItem,
  input: PromoteSavedItemInput,
  idempotencyKey: string,
) {
  if (!deps.createGeneralAction) throw new Error("General Action promotion is unavailable.");
  // Hydrated here rather than by the caller: the selected audience is the only
  // thing it is needed for, and the household destination has no audience to
  // carry - it is visible to the whole workspace by definition.
  const context = await hydrateSavedItem(store, current);
  return deps.createGeneralAction({
    id: stablePromotionDestinationId(idempotencyKey),
    ownerUserId: current.ownerUserId,
    title: input.title?.trim() || current.title,
    notes: current.content ?? current.url,
    sourceRecordId: current.sourceRecordId,
    scope: current.scope,
    householdId: current.householdId,
    selectedUserIds: current.scope === "shared" ? context.sharedWithUserIds : [],
  });
}

/**
 * **Make household Action**: a new workspace-owned destination.
 *
 * The Saved Item itself is not transferred and never becomes household-native -
 * it is archived as resolved, exactly as any other promotion archives its
 * source. What the owner is agreeing to is that the *Action* now belongs to the
 * household and stays there if they leave.
 *
 * It needs a household the owner is actually in, which the item's own household
 * scope is: an item that is private, or shared into no household, has no
 * workspace to hand an Action to.
 */
async function createHouseholdDestination(
  deps: SavedItemLifecycleDeps,
  current: MemberOwnedSavedItem,
  input: PromoteSavedItemInput,
  idempotencyKey: string,
) {
  if (!current.householdId) {
    throw new SavedItemValidationError(
      "Share this with your household first, then it can become a household Action.",
    );
  }
  if (!deps.createHouseholdNativeGeneralAction) {
    throw new SavedItemUnavailableDestinationError(
      "Household Actions aren't available yet, so this can stay here for now.",
    );
  }
  return deps.createHouseholdNativeGeneralAction({
    id: stablePromotionDestinationId(idempotencyKey),
    householdId: current.householdId,
    createdByUserId: current.ownerUserId,
    title: input.title?.trim() || current.title,
    notes: current.content ?? current.url,
    sourceRecordId: current.sourceRecordId,
  });
}

export async function promoteSavedItem(
  store: SavedItemLifecycleStore,
  deps: SavedItemLifecycleDeps,
  input: PromoteSavedItemInput,
) {
  const current = await requireOwnedSavedItem(store, input);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new SavedItemValidationError("A promotion needs an idempotency key.");
  const existing = (await store.listSavedItemOutcomes({ savedItemId: current.id })).find(
    (outcome) => outcome.idempotencyKey === idempotencyKey,
  );
  if (existing) {
    return {
      savedItem: await completePromotion(store, input, existing, true),
      affectedGeneralActionScopes: [],
    };
  }
  if (input.authority !== "explicit") {
    throw new SavedItemValidationError(
      "An inferred Saved Item promotion must be reviewed before it creates a record.",
    );
  }
  assertSavedItemEditable(current);
  const action =
    input.destination === "household_native"
      ? await createHouseholdDestination(deps, current, input, idempotencyKey)
      : await createOwnDestination(store, deps, current, input, idempotencyKey);
  const savedItemOutcome = await store.createSavedItemOutcome({
    savedItemId: current.id,
    destinationKind: "general_action",
    destinationRecordId: action.result.id,
    idempotencyKey,
  });
  return {
    savedItem: await completePromotion(store, input, savedItemOutcome, false),
    affectedGeneralActionScopes: action.affectedScopes,
  };
}
