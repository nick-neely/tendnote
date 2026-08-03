import type { ConversationalCaptureRoute } from "@tendnote/domain";
import type { AffectedScope } from "../../affected-scopes";
import { affectedScopesForSavedItem } from "../../assets/affected-scopes";
import { hydrateSavedItem } from "../../saved-items/context";
import { createGroundedSavedItem } from "../../saved-items/creation";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import { createAssetReviewDestination } from "./destinations/assets";
import { parseOutcomeConfirmation } from "./destinations/confirmation";
import { createMemoryDestination, createSuggestedMemoryReview } from "./destinations/memories";
import { createPersonDestination } from "./destinations/people";
import {
  actionConfirmation,
  contextFactConfirmation,
  fallbackKind,
  followupConfirmation,
  savedItemConfirmation,
} from "./policy";
import type { CaptureVisibility, ConversationalCaptureDeps, ResolvedCapturePerson } from "./types";

export type CaptureDestinationIds = {
  savedItemId: string;
  savedItemEventId: string;
  generalActionId: string;
  followupId: string;
};

export type ResolvedCaptureRoute = Exclude<
  ConversationalCaptureRoute,
  { destination: "clarification" | "group" }
>;

export type CaptureDestinationInput<Route extends ResolvedCaptureRoute = ResolvedCaptureRoute> = {
  store: SavedItemLifecycleStore;
  deps: ConversationalCaptureDeps;
  route: Route;
  resolvedPerson?: ResolvedCapturePerson | null;
  ownerUserId: string;
  originalText: string;
  sourceRecordId: string;
  visibility: CaptureVisibility;
  excludedAssetReviewGroupId?: string;
  ids: CaptureDestinationIds;
};

export async function createCaptureDestination(input: CaptureDestinationInput) {
  if (input.route.destination === "action") {
    return createActionDestination({ ...input, route: input.route });
  }
  if (input.route.destination === "followup") {
    return createFollowupDestination({ ...input, route: input.route });
  }
  if (input.route.destination === "person") {
    return createPersonDestination({ ...input, route: input.route });
  }
  if (input.route.destination === "memory") {
    return createMemoryDestination({ ...input, route: input.route });
  }
  if (input.route.destination === "asset_review") {
    return createAssetReviewDestination({ ...input, route: input.route });
  }
  if (input.route.destination === "context_fact") {
    return createContextFactDestination({ ...input, route: input.route });
  }
  return createSavedItemDestination({ ...input, route: input.route });
}

export async function createInferredCaptureReview(input: {
  deps: ConversationalCaptureDeps;
  ownerUserId: string;
  sourceRecordId: string;
  suggestion: import("@tendnote/domain").ConversationalCaptureInferredSuggestion;
}) {
  if (input.suggestion.kind === "memory") {
    return createSuggestedMemoryReview({
      deps: input.deps,
      ownerUserId: input.ownerUserId,
      sourceRecordId: input.sourceRecordId,
      suggestion: input.suggestion,
    });
  }
  return createAssetReviewDestination({
    deps: input.deps,
    ownerUserId: input.ownerUserId,
    originalText: input.suggestion.assetName,
    sourceRecordId: input.sourceRecordId,
    visibility: {
      scope: "private",
      householdId: null,
      selectedUserIds: [],
      label: "Only me",
      captureText: input.suggestion.assetName,
    },
    route: {
      destination: "asset_review",
      assetName: input.suggestion.assetName,
      assetKind: input.suggestion.assetKind,
      fact: input.suggestion.fact ?? null,
    },
    directlyRequested: false,
  });
}

async function createActionDestination(
  input: CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "action" }>>,
) {
  const { createGeneralAction } = input.deps;
  if (!createGeneralAction) throw new Error("Action capture is unavailable.");
  const getExisting = () =>
    input.deps.getGeneralAction?.({
      ownerUserId: input.ownerUserId,
      generalActionId: input.ids.generalActionId,
    });
  let generalAction = await getExisting();
  let affectedScopes: AffectedScope[] = [];
  if (!generalAction) {
    try {
      const outcome = await createGeneralAction({
        id: input.ids.generalActionId,
        ownerUserId: input.ownerUserId,
        title: input.route.title,
        dueAt: input.route.dueAt,
        recurrence: input.route.recurrence,
        sourceRecordId: input.sourceRecordId,
        scope: input.visibility.scope,
        ...(input.visibility.householdId ? { householdId: input.visibility.householdId } : {}),
        ...(input.visibility.scope === "shared"
          ? { selectedUserIds: input.visibility.selectedUserIds }
          : {}),
      });
      generalAction = outcome.result;
      affectedScopes = outcome.affectedScopes;
    } catch (error) {
      const racedAction = await getExisting();
      if (!racedAction) throw error;
      generalAction = racedAction;
    }
  }
  const confirmation = parseOutcomeConfirmation(
    actionConfirmation({
      sourceRecordId: input.sourceRecordId,
      generalActionId: generalAction.id,
      route: input.route,
      visibilityLabel: input.visibility.label,
    }),
  );
  return {
    kind: "general_action" as const,
    generalAction,
    affectedScopes,
    confirmation,
    id: generalAction.id,
    ...(input.route.reminderSchedule ? { reminderSchedule: input.route.reminderSchedule } : {}),
  };
}

async function createFollowupDestination(
  input: CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "followup" }>>,
) {
  const { createFollowup } = input.deps;
  if (!createFollowup || !input.resolvedPerson) {
    throw new Error("Follow-Up capture is unavailable.");
  }
  const getExisting = () =>
    input.deps.getFollowup?.({
      ownerUserId: input.ownerUserId,
      followupId: input.ids.followupId,
    });
  let followup = await getExisting();
  let affectedScopes: AffectedScope[] = [];
  if (!followup) {
    try {
      const outcome = await createFollowup({
        id: input.ids.followupId,
        ownerUserId: input.ownerUserId,
        personId: input.resolvedPerson.id,
        reason: input.route.reason,
        dueAt: input.route.dueAt,
        sourceRecordId: input.sourceRecordId,
        scope: input.visibility.scope,
        ...(input.visibility.householdId ? { householdId: input.visibility.householdId } : {}),
        ...(input.visibility.scope === "shared"
          ? { selectedUserIds: input.visibility.selectedUserIds }
          : {}),
      });
      followup = outcome.result;
      affectedScopes = outcome.affectedScopes;
    } catch (error) {
      const racedFollowup = await getExisting();
      if (!racedFollowup) throw error;
      followup = racedFollowup;
    }
  }
  const confirmation = parseOutcomeConfirmation(
    followupConfirmation({
      sourceRecordId: input.sourceRecordId,
      followupId: followup.id,
      person: input.resolvedPerson,
      route: input.route,
      visibilityLabel: input.visibility.label,
    }),
  );
  return {
    kind: "followup" as const,
    followup,
    affectedScopes,
    confirmation,
    id: followup.id,
  };
}

async function createSavedItemDestination(
  input: CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "saved_item" }>>,
) {
  const existing = await input.store.getSavedItem({
    ownerUserId: input.ownerUserId,
    savedItemId: input.ids.savedItemId,
  });
  if (existing && existing.sourceRecordId !== input.sourceRecordId) {
    throw new Error("This capture interaction is linked to different source evidence.");
  }
  const kind = fallbackKind(input.originalText);
  const itemKind = input.route.kind ?? kind;
  const itemText = input.route.text ?? input.originalText;
  const created = !existing;
  const savedItem = existing
    ? await hydrateSavedItem(input.store, existing)
    : await createGroundedSavedItem(input.store, {
        id: input.ids.savedItemId,
        createdEventId: input.ids.savedItemEventId,
        ownerUserId: input.ownerUserId,
        kind: itemKind,
        title: itemText.slice(0, 240),
        content: itemKind === "link" ? null : itemText,
        url: itemKind === "link" ? itemText : null,
        bringBackAt: input.route.bringBackAt ?? null,
        originalText: input.originalText,
        sourceRecordId: input.sourceRecordId,
        scope: input.visibility.scope,
        ...(input.visibility.householdId ? { householdId: input.visibility.householdId } : {}),
        ...(input.visibility.scope === "shared"
          ? { selectedUserIds: input.visibility.selectedUserIds }
          : {}),
      });
  const confirmation = parseOutcomeConfirmation(
    savedItemConfirmation({
      sourceRecordId: input.sourceRecordId,
      savedItemId: savedItem.id,
      kind: itemKind,
      visibilityLabel: input.visibility.label,
    }),
  );
  return {
    kind: "saved_item" as const,
    savedItem,
    affectedScopes: created ? affectedScopesForSavedItem(savedItem) : [],
    confirmation,
    id: savedItem.id,
  };
}

async function createContextFactDestination(
  input: CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "context_fact" }>>,
) {
  if (input.visibility.scope !== "private") {
    throw new Error("Self Context capture must remain private.");
  }
  if (!input.deps.createSelfContextFact) {
    throw new Error("Self Context capture is unavailable.");
  }
  const outcome = await input.deps.createSelfContextFact({
    ownerUserId: input.ownerUserId,
    category: input.route.category,
    content: input.route.content,
    sensitivity: input.route.sensitivity,
    sourceRecordId: input.sourceRecordId,
  });
  const confirmation = parseOutcomeConfirmation(
    contextFactConfirmation({
      sourceRecordId: input.sourceRecordId,
      contextFactId: outcome.result.id,
      route: input.route,
      visibilityLabel: input.visibility.label,
      expectedUpdatedAt: outcome.result.updatedAt,
    }),
  );
  return {
    kind: "context_fact" as const,
    contextFact: outcome.result,
    affectedScopes: outcome.affectedScopes,
    confirmation,
    id: outcome.result.id,
  };
}
