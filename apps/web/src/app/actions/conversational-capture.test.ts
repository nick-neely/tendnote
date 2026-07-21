import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveOrCreateAndLinkPersonToSourceRecord,
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  revalidatePath,
  undoExplicitCaptureOutcome,
} = vi.hoisted(() => ({
  resolveOrCreateAndLinkPersonToSourceRecord: vi.fn(),
  captureExplicitOutcome: vi.fn(),
  changeExplicitCaptureOutcome: vi.fn(),
  revalidatePath: vi.fn(),
  undoExplicitCaptureOutcome: vi.fn(),
}));

vi.mock("@tendnote/db/queries/conversational-capture", () => ({
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
}));
vi.mock("@tendnote/db/queries/source-records", () => ({
  resolveOrCreateAndLinkPersonToSourceRecord,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: vi.fn().mockResolvedValue("owner-1"),
}));

import {
  addCapturePersonAction,
  captureExplicitOutcomeAction,
  changeExplicitCaptureOutcomeAction,
  undoExplicitCaptureOutcomeAction,
} from "./conversational-capture";

const SAVED_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const confirmation = {
  destination: "Saved Items" as const,
  groundedBySourceRecordId: "source-1",
  interpreted: { kind: "Note" as const, visibility: "Only me" as const },
  change: { kind: "edit_saved_item" as const, savedItemId: SAVED_ITEM_ID },
  undo: { kind: "archive_saved_item" as const, savedItemId: SAVED_ITEM_ID },
};

beforeEach(() => {
  vi.clearAllMocks();
  captureExplicitOutcome.mockResolvedValue({ confirmation });
  changeExplicitCaptureOutcome.mockResolvedValue({ id: SAVED_ITEM_ID });
  undoExplicitCaptureOutcome.mockResolvedValue({ id: SAVED_ITEM_ID, status: "archived" });
  resolveOrCreateAndLinkPersonToSourceRecord.mockResolvedValue({
    person: { id: "person-1", displayName: "Maya" },
    created: true,
  });
});

describe("conversational Capture web adapters", () => {
  it("adds an unknown Person through the owner-scoped mutation before clarification continues", async () => {
    await expect(
      addCapturePersonAction({ displayName: "Maya", sourceRecordId: "source-1" }),
    ).resolves.toEqual({
      displayName: "Maya",
    });
    expect(resolveOrCreateAndLinkPersonToSourceRecord).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      sourceRecordId: "source-1",
      displayName: "Maya",
      role: "primary",
    });
  });

  it("derives owner and authority server-side before calling the shared operation", async () => {
    const result = await captureExplicitOutcomeAction({
      interactionId: "browser-interaction",
      inputMode: "typed",
      originalText: "Keep this note",
    });
    expect(captureExplicitOutcome).toHaveBeenCalledWith({
      authority: "explicit",
      interactionId: "browser-interaction",
      inputMode: "typed",
      originalText: "Keep this note",
      ownerUserId: "owner-1",
      surface: "global_capture",
    });
    expect(result.confirmation).toEqual(confirmation);
  });

  it("keeps corrections and Undo owner-scoped through Saved Item lifecycle operations", async () => {
    await changeExplicitCaptureOutcomeAction({
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      originalText: "Corrected note",
    });
    expect(changeExplicitCaptureOutcome).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      originalText: "Corrected note",
    });

    await undoExplicitCaptureOutcomeAction({
      target: { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID },
    });
    expect(undoExplicitCaptureOutcome).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      target: { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID },
    });
  });

  it("returns a replacement confirmation when Change reroutes the grounded capture", async () => {
    const actionConfirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: {
        title: "Replace the filter",
        dueAt: null,
        cadence: null,
        scope: "Only me" as const,
      },
      change: {
        kind: "edit_general_action" as const,
        generalActionId: "22222222-2222-4222-8222-222222222222",
      },
      undo: {
        kind: "archive_general_action" as const,
        generalActionId: "22222222-2222-4222-8222-222222222222",
      },
    };
    changeExplicitCaptureOutcome.mockResolvedValue({ confirmation: actionConfirmation });

    const result = await changeExplicitCaptureOutcomeAction({
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      originalText: "I need to replace the filter",
    });

    expect(result).toEqual({ confirmation: actionConfirmation });
  });
});
