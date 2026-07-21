import {
  type ConversationalCaptureChangeTarget,
  type ConversationalCaptureRoute,
  conversationalCaptureChangeRequestSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureDestinationChangeRequestSchema,
  conversationalCaptureDestinationUndoRequestSchema,
  conversationalCaptureUndoRequestSchema,
  SavedItemValidationError,
} from "@tendnote/domain";
import { hydrateSavedItem } from "../../saved-items/context";
import { createSavedItemLifecycle } from "../../saved-items/lifecycle";
import type { SavedItemLifecycleStore, SavedItemWithContext } from "../../saved-items/types";
import { createCaptureDestination } from "./destinations";
import {
  type CaptureOutcomeReference,
  changeTargetReference,
  createCaptureOutcomeLifecycleOperations,
  undoTargetReference,
} from "./lifecycle-operations";
import {
  actionConfirmation,
  changeTargetKey,
  followupConfirmation,
  resolveCompletedCaptureRoute,
  resolveExactCapturePerson,
  routeDestinationLabel,
  savedItemConfirmation,
  stableRerouteUuid,
} from "./policy";
import type { ConversationalCaptureDeps, ResolvedCapturePerson } from "./types";

type ResolvedRoute = Exclude<ConversationalCaptureRoute, { destination: "clarification" }>;

export function createCorrectionOperations(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps,
) {
  const lifecycle = createSavedItemLifecycle(store);
  const outcomeLifecycle = createCaptureOutcomeLifecycleOperations(store, deps);

  async function changeSavedItem(input: {
    actorUserId: string;
    savedItemId: string;
    originalText: string;
  }) {
    const parsed = conversationalCaptureChangeRequestSchema.parse(input);
    const current = await store.getSavedItem({
      ownerUserId: parsed.actorUserId,
      savedItemId: parsed.savedItemId,
    });
    if (!current) throw new Error("That Saved Item is no longer available.");
    let url: string | null = null;
    if (current.kind === "link") {
      try {
        url = new URL(parsed.originalText).toString();
      } catch {
        throw new SavedItemValidationError("A link capture must remain a valid URL.");
      }
    }
    return lifecycle.editSavedItem({
      actorUserId: parsed.actorUserId,
      savedItemId: parsed.savedItemId,
      edit: {
        title: parsed.originalText.slice(0, 240),
        ...(current.kind === "link" ? { url } : { content: parsed.originalText }),
      },
    });
  }

  async function changeOutcome(input: {
    actorUserId: string;
    clarificationAnswer?: string;
    target: ConversationalCaptureChangeTarget;
    originalText: string;
  }) {
    const parsed = conversationalCaptureDestinationChangeRequestSchema.parse(input);
    const route = await resolveCompletedCaptureRoute({
      deps,
      ownerUserId: parsed.actorUserId,
      originalText: parsed.originalText,
      ...(parsed.clarificationAnswer ? { clarificationAnswer: parsed.clarificationAnswer } : {}),
    });
    const target = changeTargetReference(parsed.target);
    const current = await outcomeLifecycle[target.kind].load(parsed.actorUserId, target.id);
    const sourceRecord = await store.getSourceRecord({
      ownerUserId: parsed.actorUserId,
      sourceRecordId: current.sourceRecordId,
    });
    if (!sourceRecord) throw new Error("The original capture evidence is no longer available.");
    if (route.destination === "clarification") {
      return {
        sourceRecord,
        clarification: conversationalCaptureClarificationSchema.parse({
          field: route.field,
          question: route.question,
          sourceRecordId: sourceRecord.id,
        }),
      };
    }

    let resolvedPerson: ResolvedCapturePerson | null = null;
    if (route.destination === "followup") {
      const resolution = await resolveExactCapturePerson({
        deps,
        ownerUserId: parsed.actorUserId,
        personQuery: route.personQuery,
      });
      if (!resolution.person) {
        return {
          sourceRecord,
          clarification: conversationalCaptureClarificationSchema.parse({
            field: "person",
            question: resolution.question,
            sourceRecordId: sourceRecord.id,
            ...(resolution.actions ? { actions: resolution.actions } : {}),
          }),
        };
      }
      resolvedPerson = resolution.person;
    }

    const edited = await editSameDestination({
      deps,
      changeSavedItem,
      actorUserId: parsed.actorUserId,
      target,
      originalText: parsed.originalText,
      sourceRecordId: sourceRecord.id,
      currentPersonId: current.personId,
      route,
      resolvedPerson,
    });
    if (edited) return { sourceRecord, ...edited };

    const to = routeDestinationLabel(route);
    if (!to) throw new Error("Correction still needs clarification.");
    const transitionKey = `${changeTargetKey(parsed.target)}:${to}`;
    const rerouteId = (recordKind: Parameters<typeof stableRerouteUuid>[0]["recordKind"]) =>
      stableRerouteUuid({
        ownerUserId: parsed.actorUserId,
        sourceRecordId: sourceRecord.id,
        transitionKey,
        recordKind,
      });
    const corrected = await createCaptureDestination({
      store,
      deps,
      route,
      resolvedPerson,
      ownerUserId: parsed.actorUserId,
      originalText: parsed.originalText,
      sourceRecordId: sourceRecord.id,
      ids: {
        savedItemId: rerouteId("saved_item"),
        savedItemEventId: rerouteId("saved_item_event"),
        generalActionId: rerouteId("general_action"),
        followupId: rerouteId("followup"),
      },
    });
    await outcomeLifecycle[target.kind].archive(parsed.actorUserId, target.id, current.status);
    await store.createSourceRecordAuditLogEntry({
      id: rerouteId("audit"),
      ownerUserId: parsed.actorUserId,
      action: "capture.reroute",
      entityType: "source_record",
      entityId: sourceRecord.id,
      metadataJson: {
        from: current.from,
        fromStatus: current.status,
        to,
        correctedRecordId: corrected.id,
      },
    });
    return { sourceRecord, ...corrected };
  }

  async function undoSavedItem(input: { actorUserId: string; savedItemId: string }) {
    const parsed = conversationalCaptureUndoRequestSchema.parse(input);
    const current = await store.getSavedItem({
      ownerUserId: parsed.actorUserId,
      savedItemId: parsed.savedItemId,
    });
    if (!current) throw new Error("That Saved Item is no longer available.");
    if (current.status === "archived") return hydrateSavedItem(store, current);
    return lifecycle.archiveSavedItem(parsed);
  }

  async function undoOutcome(input: {
    actorUserId: string;
    target:
      | { kind: "archive_saved_item"; savedItemId: string }
      | { kind: "archive_general_action"; generalActionId: string }
      | { kind: "archive_followup"; followupId: string };
  }) {
    const parsed = conversationalCaptureDestinationUndoRequestSchema.parse(input);
    const target = undoTargetReference(parsed.target);
    return outcomeLifecycle[target.kind].undo(parsed.actorUserId, target.id);
  }

  return { changeSavedItem, changeOutcome, undoSavedItem, undoOutcome };
}

async function editSameDestination(input: {
  deps: ConversationalCaptureDeps;
  changeSavedItem: (input: {
    actorUserId: string;
    savedItemId: string;
    originalText: string;
  }) => Promise<SavedItemWithContext>;
  actorUserId: string;
  target: CaptureOutcomeReference;
  originalText: string;
  sourceRecordId: string;
  currentPersonId?: string;
  route: ResolvedRoute;
  resolvedPerson: ResolvedCapturePerson | null;
}) {
  if (input.target.kind === "saved_item" && input.route.destination === "saved_item") {
    const savedItem = await input.changeSavedItem({
      actorUserId: input.actorUserId,
      savedItemId: input.target.id,
      originalText: input.originalText,
    });
    return {
      savedItem,
      confirmation: conversationalCaptureConfirmationSchema.parse(
        savedItemConfirmation({
          sourceRecordId: input.sourceRecordId,
          savedItemId: input.target.id,
          kind: savedItem.kind,
        }),
      ),
    };
  }
  if (input.target.kind === "general_action" && input.route.destination === "action") {
    if (!input.deps.editGeneralAction) throw new Error("Action correction is unavailable.");
    const generalAction = await input.deps.editGeneralAction({
      actorUserId: input.actorUserId,
      generalActionId: input.target.id,
      edit: {
        title: input.route.title,
        dueAt: input.route.dueAt,
        recurrence: input.route.recurrence,
      },
    });
    return {
      generalAction,
      confirmation: conversationalCaptureConfirmationSchema.parse(
        actionConfirmation({
          sourceRecordId: input.sourceRecordId,
          generalActionId: input.target.id,
          route: input.route,
        }),
      ),
    };
  }
  if (
    input.target.kind === "followup" &&
    input.route.destination === "followup" &&
    input.resolvedPerson?.id === input.currentPersonId
  ) {
    if (!input.deps.editFollowup) throw new Error("Follow-Up correction is unavailable.");
    const resolvedPerson = input.resolvedPerson;
    if (!resolvedPerson) throw new Error("Follow-Up person resolution was lost.");
    const followup = await input.deps.editFollowup({
      actorUserId: input.actorUserId,
      followupId: input.target.id,
      edit: { reason: input.route.reason, dueAt: input.route.dueAt },
    });
    return {
      followup,
      confirmation: conversationalCaptureConfirmationSchema.parse(
        followupConfirmation({
          sourceRecordId: input.sourceRecordId,
          followupId: input.target.id,
          person: resolvedPerson,
          route: input.route,
        }),
      ),
    };
  }
  return null;
}
