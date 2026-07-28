import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  requestBackgroundAffectedScopeReconciliation,
  undoExplicitCaptureOutcome,
} = vi.hoisted(() => ({
  captureExplicitOutcome: vi.fn(),
  changeExplicitCaptureOutcome: vi.fn(),
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
  undoExplicitCaptureOutcome: vi.fn(),
}));

vi.mock("@tendnote/db/queries/conversational-capture", () => ({
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: tool } = await import("../agent/tools/capture_saved_item");
const { default: changeTool } = await import("../agent/tools/change_saved_item_capture");
const { default: undoTool } = await import("../agent/tools/undo_saved_item_capture");
const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;
const SAVED_ITEM_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("capture_saved_item", () => {
  it("routes explicit Eve saves through the shared owner-scoped operation", async () => {
    captureExplicitOutcome.mockResolvedValue({
      savedItem: {
        id: "saved-1",
        kind: "note",
        scope: "private",
        sourceRecordId: "source-1",
      },
      confirmation: {
        destination: "Saved Items",
        groundedBySourceRecordId: "source-1",
        interpreted: { kind: "Note", visibility: "Only me" },
        change: { kind: "edit_saved_item", savedItemId: "saved-1" },
        undo: { kind: "archive_saved_item", savedItemId: "saved-1" },
      },
    });

    const result = await tool.execute(
      {
        interactionId: "eve-turn-1",
        inputMode: "dictated",
        originalText: "Keep the refrigerator filter model handy",
      },
      ctx,
    );

    expect(captureExplicitOutcome).toHaveBeenCalledWith({
      authority: "explicit",
      interactionId: "eve-turn-1",
      inputMode: "dictated",
      originalText: "Keep the refrigerator filter model handy",
      ownerUserId: "owner-1",
      surface: "eve",
    });
    expect(result.confirmation?.destination).toBe("Saved Items");
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([]);
  });

  it("returns the one source-first clarification and reuses the operation to complete it", async () => {
    captureExplicitOutcome.mockResolvedValue({
      clarification: {
        field: "timing",
        question: "When should I remind you to replace the filter?",
        sourceRecordId: "source-1",
      },
    });

    const result = await tool.execute(
      {
        clarificationAnswer: "tomorrow",
        interactionId: "eve-turn-clarify",
        inputMode: "typed",
        originalText: "Remind me to replace the filter sometime",
      },
      ctx,
    );

    expect(result.clarification?.sourceRecordId).toBe("source-1");
    expect(captureExplicitOutcome).toHaveBeenCalledWith({
      authority: "explicit",
      clarificationAnswer: "tomorrow",
      interactionId: "eve-turn-clarify",
      inputMode: "typed",
      originalText: "Remind me to replace the filter sometime",
      ownerUserId: "owner-1",
      surface: "eve",
    });
  });

  it("keeps Eve Change and Undo on the same owner-scoped product boundary", async () => {
    changeExplicitCaptureOutcome.mockResolvedValue({
      id: SAVED_ITEM_ID,
      sourceRecordId: "source-1",
    });
    undoExplicitCaptureOutcome.mockResolvedValue({ id: SAVED_ITEM_ID, status: "archived" });

    await changeTool.execute(
      {
        originalText: "Corrected filter note",
        target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      },
      ctx,
    );
    await undoTool.execute(
      { target: { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID } },
      ctx,
    );

    expect(changeExplicitCaptureOutcome).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      originalText: "Corrected filter note",
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
    });
    expect(undoExplicitCaptureOutcome).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      target: { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID },
    });
  });
});
