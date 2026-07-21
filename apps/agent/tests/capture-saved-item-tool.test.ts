import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExplicitSavedItem, changeExplicitSavedItemCapture, undoExplicitSavedItemCapture } =
  vi.hoisted(() => ({
    captureExplicitSavedItem: vi.fn(),
    changeExplicitSavedItemCapture: vi.fn(),
    undoExplicitSavedItemCapture: vi.fn(),
  }));

vi.mock("@tendnote/db/queries/conversational-capture", () => ({
  captureExplicitSavedItem,
  changeExplicitSavedItemCapture,
  undoExplicitSavedItemCapture,
}));

const { default: tool } = await import("../agent/tools/capture_saved_item");
const { default: changeTool } = await import("../agent/tools/change_saved_item_capture");
const { default: undoTool } = await import("../agent/tools/undo_saved_item_capture");
const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;
const SAVED_ITEM_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("capture_saved_item", () => {
  it("routes explicit Eve saves through the shared owner-scoped operation", async () => {
    captureExplicitSavedItem.mockResolvedValue({
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

    expect(captureExplicitSavedItem).toHaveBeenCalledWith({
      authority: "explicit",
      interactionId: "eve-turn-1",
      inputMode: "dictated",
      originalText: "Keep the refrigerator filter model handy",
      ownerUserId: "owner-1",
      surface: "eve",
    });
    expect(result.confirmation.interpreted.visibility).toBe("Only me");
  });

  it("keeps Eve Change and Undo on the same owner-scoped product boundary", async () => {
    changeExplicitSavedItemCapture.mockResolvedValue({
      id: SAVED_ITEM_ID,
      sourceRecordId: "source-1",
    });
    undoExplicitSavedItemCapture.mockResolvedValue({ id: SAVED_ITEM_ID, status: "archived" });

    await changeTool.execute(
      { originalText: "Corrected filter note", savedItemId: SAVED_ITEM_ID },
      ctx,
    );
    await undoTool.execute({ savedItemId: SAVED_ITEM_ID }, ctx);

    expect(changeExplicitSavedItemCapture).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      originalText: "Corrected filter note",
      savedItemId: SAVED_ITEM_ID,
    });
    expect(undoExplicitSavedItemCapture).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: SAVED_ITEM_ID,
    });
  });
});
