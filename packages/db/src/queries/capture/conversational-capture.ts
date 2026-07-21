import { createHash } from "node:crypto";
import {
  type ConversationalCaptureRequest,
  conversationalCaptureChangeRequestSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureRequestSchema,
  conversationalCaptureUndoRequestSchema,
  createSourceRecordSchema,
  type SavedItemKind,
  SavedItemValidationError,
} from "@tendnote/domain";
import { hydrateSavedItem } from "../saved-items/context";
import { createGroundedSavedItem } from "../saved-items/creation";
import { createSavedItemLifecycle } from "../saved-items/lifecycle";
import type { SavedItemLifecycleStore } from "../saved-items/types";

export type ConversationalCaptureInput = ConversationalCaptureRequest;

function fallbackKind(originalText: string): SavedItemKind {
  try {
    new URL(originalText);
    return "link";
  } catch {
    return originalText.endsWith("?") ? "open_question" : "note";
  }
}

function kindLabel(kind: SavedItemKind) {
  if (kind === "open_question") return "Open question";
  return kind === "link" ? "Link" : "Note";
}

function stableCaptureUuid(
  input: ConversationalCaptureInput,
  recordKind: "source" | "source_audit" | "saved_item" | "saved_item_event",
) {
  const hex = createHash("sha256")
    .update(`capture:${recordKind}:${input.ownerUserId}:${input.interactionId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function captureInputHash(input: ConversationalCaptureInput, originalText: string) {
  return createHash("sha256")
    .update(`${input.surface}\0${input.inputMode}\0${originalText}`)
    .digest("hex");
}

export function createConversationalCapture(store: SavedItemLifecycleStore) {
  const lifecycle = createSavedItemLifecycle(store);
  return {
    async capture(input: ConversationalCaptureInput) {
      const parsedInput = conversationalCaptureRequestSchema.parse(input);
      const originalText = parsedInput.originalText;
      const kind = fallbackKind(originalText);
      const sourceRecordId = stableCaptureUuid(parsedInput, "source");
      const sourceAuditId = stableCaptureUuid(parsedInput, "source_audit");
      const savedItemId = stableCaptureUuid(parsedInput, "saved_item");
      const savedItemEventId = stableCaptureUuid(parsedInput, "saved_item_event");
      const inputHash = captureInputHash(parsedInput, originalText);
      const existingSource = await store.getSourceRecord({
        ownerUserId: parsedInput.ownerUserId,
        sourceRecordId,
      });
      if (existingSource && existingSource.metadataJson.captureInputHash !== inputHash) {
        throw new Error("This capture interaction was already used for different input.");
      }
      const sourceRecord =
        existingSource ??
        (await store.createSourceRecord(
          createSourceRecordSchema.parse({
            id: sourceRecordId,
            ownerUserId: parsedInput.ownerUserId,
            sourceType: "manual",
            content: originalText,
            rawContent: null,
            retentionPolicy: "retain",
            status: "active",
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
          id: sourceAuditId,
          ownerUserId: parsedInput.ownerUserId,
          action: "capture.explicit_saved_item_source_created",
          entityType: "source_record",
          entityId: sourceRecord.id,
          metadataJson: {
            authority: parsedInput.authority,
            captureSurface: parsedInput.surface,
            inputMode: parsedInput.inputMode,
          },
        });
      }
      const existingSavedItem = await store.getSavedItem({
        ownerUserId: parsedInput.ownerUserId,
        savedItemId,
      });
      if (existingSavedItem && existingSavedItem.sourceRecordId !== sourceRecord.id) {
        throw new Error("This capture interaction is linked to different source evidence.");
      }
      const savedItem = existingSavedItem
        ? await hydrateSavedItem(store, existingSavedItem)
        : await createGroundedSavedItem(store, {
            id: savedItemId,
            createdEventId: savedItemEventId,
            ownerUserId: parsedInput.ownerUserId,
            kind,
            title: originalText.slice(0, 240),
            content: kind === "link" ? null : originalText,
            url: kind === "link" ? originalText : null,
            originalText,
            sourceRecordId: sourceRecord.id,
            scope: "private",
          });

      const confirmation = conversationalCaptureConfirmationSchema.parse({
        destination: "Saved Items",
        groundedBySourceRecordId: sourceRecord.id,
        interpreted: { kind: kindLabel(kind), visibility: "Only me" },
        change: { kind: "edit_saved_item", savedItemId: savedItem.id },
        undo: { kind: "archive_saved_item", savedItemId: savedItem.id },
      });

      return {
        sourceRecord,
        savedItem,
        confirmation,
      };
    },
    async change(input: { actorUserId: string; savedItemId: string; originalText: string }) {
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
    },
    async undo(input: { actorUserId: string; savedItemId: string }) {
      const parsed = conversationalCaptureUndoRequestSchema.parse(input);
      const current = await store.getSavedItem({
        ownerUserId: parsed.actorUserId,
        savedItemId: parsed.savedItemId,
      });
      if (!current) throw new Error("That Saved Item is no longer available.");
      if (current.status === "archived") return hydrateSavedItem(store, current);
      return lifecycle.archiveSavedItem(parsed);
    },
  };
}
