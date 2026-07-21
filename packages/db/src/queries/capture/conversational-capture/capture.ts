import {
  conversationalCaptureClarificationSchema,
  conversationalCaptureRequestSchema,
  createSourceRecordSchema,
} from "@tendnote/domain";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import { createCaptureDestination } from "./destinations";
import {
  captureInputHash,
  resolveCompletedCaptureRoute,
  resolveExactCapturePerson,
  stableCaptureUuid,
} from "./policy";
import type {
  ConversationalCaptureDeps,
  ConversationalCaptureInput,
  ConversationalCaptureResult,
} from "./types";

export function createCaptureOperation(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps,
) {
  return async function capture(
    input: ConversationalCaptureInput,
  ): Promise<ConversationalCaptureResult> {
    const parsedInput = conversationalCaptureRequestSchema.parse(input);
    const route = await resolveCompletedCaptureRoute({
      deps,
      ownerUserId: parsedInput.ownerUserId,
      originalText: parsedInput.originalText,
      ...(parsedInput.clarificationAnswer
        ? { clarificationAnswer: parsedInput.clarificationAnswer }
        : {}),
    });
    const sourceRecordId = stableCaptureUuid(parsedInput, "source");
    const inputHash = captureInputHash(parsedInput, parsedInput.originalText);
    const existingSource = await store.getSourceRecord({
      ownerUserId: parsedInput.ownerUserId,
      sourceRecordId,
    });
    if (existingSource && existingSource.metadataJson.captureInputHash !== inputHash) {
      throw new Error("This capture interaction was already used for different input.");
    }
    let sourceRecord =
      existingSource ??
      (await store.createSourceRecord(
        createSourceRecordSchema.parse({
          id: sourceRecordId,
          ownerUserId: parsedInput.ownerUserId,
          sourceType: "manual",
          content: parsedInput.originalText,
          rawContent: null,
          retentionPolicy: "retain",
          status: route.destination === "clarification" ? "pending_resolution" : "active",
          confidence: "high",
          sensitivity: "normal",
          scope: "private",
          householdId: null,
          importance: 3,
          metadataJson: {
            audioRetained: false,
            authority: parsedInput.authority,
            captureSurface: parsedInput.surface,
            captureInputHash: inputHash,
            inputMode: parsedInput.inputMode,
            interactionId: parsedInput.interactionId,
          },
        }),
      ));
    if (sourceRecord.metadataJson.captureInputHash !== inputHash) {
      throw new Error("This capture interaction was already used for different input.");
    }
    if (!existingSource) {
      await store.createSourceRecordAuditLogEntry({
        id: stableCaptureUuid(parsedInput, "source_audit"),
        ownerUserId: parsedInput.ownerUserId,
        action: `capture.explicit_${route.destination}_source_created`,
        entityType: "source_record",
        entityId: sourceRecord.id,
        metadataJson: {
          authority: parsedInput.authority,
          captureSurface: parsedInput.surface,
          inputMode: parsedInput.inputMode,
        },
      });
    }
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

    let resolvedPerson = null;
    if (route.destination === "followup") {
      const resolution = await resolveExactCapturePerson({
        deps,
        ownerUserId: parsedInput.ownerUserId,
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

    const outcome = await createCaptureDestination({
      store,
      deps,
      route,
      resolvedPerson,
      ownerUserId: parsedInput.ownerUserId,
      originalText: parsedInput.originalText,
      sourceRecordId: sourceRecord.id,
      ids: {
        savedItemId: stableCaptureUuid(parsedInput, "saved_item"),
        savedItemEventId: stableCaptureUuid(parsedInput, "saved_item_event"),
        generalActionId: stableCaptureUuid(parsedInput, "general_action"),
        followupId: stableCaptureUuid(parsedInput, "followup"),
      },
    });
    if (sourceRecord.status === "pending_resolution") {
      sourceRecord = await store.updateSourceRecordStatus({
        ownerUserId: parsedInput.ownerUserId,
        sourceRecordId: sourceRecord.id,
        status: "active",
      });
    }
    return { sourceRecord, ...outcome };
  };
}
