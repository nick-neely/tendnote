import { createHash } from "node:crypto";
import { assertSavedItemEditable, SavedItemValidationError } from "@tendnote/domain";
import { hydrateSavedItem, requireOwnedSavedItem } from "./context";
import type { SavedItemLifecycleDeps, SavedItemLifecycleStore } from "./types";

export type PromoteSavedItemInput = {
  actorUserId: string;
  savedItemId: string;
  authority: "explicit" | "inferred";
  idempotencyKey: string;
  title?: string;
};

function stablePromotionDestinationId(idempotencyKey: string): string {
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
            resolutionReason: "Promoted to General Action.",
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
  if (!deps.createGeneralAction) throw new Error("General Action promotion is unavailable.");
  const context = await hydrateSavedItem(store, current);
  const action = await deps.createGeneralAction({
    id: stablePromotionDestinationId(idempotencyKey),
    ownerUserId: current.ownerUserId,
    title: input.title?.trim() || current.title,
    notes: current.content ?? current.url,
    sourceRecordId: current.sourceRecordId,
    scope: current.scope,
    householdId: current.householdId,
    selectedUserIds: current.scope === "shared" ? context.sharedWithUserIds : [],
  });
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
