import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExplicitSavedItem,
  changeExplicitSavedItemCapture,
  revalidatePath,
  undoExplicitSavedItemCapture,
} = vi.hoisted(() => ({
  captureExplicitSavedItem: vi.fn(),
  changeExplicitSavedItemCapture: vi.fn(),
  revalidatePath: vi.fn(),
  undoExplicitSavedItemCapture: vi.fn(),
}));

vi.mock("@tendnote/db/queries/conversational-capture", () => ({
  captureExplicitSavedItem,
  changeExplicitSavedItemCapture,
  undoExplicitSavedItemCapture,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: vi.fn().mockResolvedValue("owner-1"),
}));

import {
  captureExplicitSavedItemAction,
  changeExplicitSavedItemCaptureAction,
  undoExplicitSavedItemCaptureAction,
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
  captureExplicitSavedItem.mockResolvedValue({ confirmation });
  changeExplicitSavedItemCapture.mockResolvedValue({ id: SAVED_ITEM_ID });
  undoExplicitSavedItemCapture.mockResolvedValue({ id: SAVED_ITEM_ID, status: "archived" });
});

describe("conversational Capture web adapters", () => {
  it("derives owner and authority server-side before calling the shared operation", async () => {
    const result = await captureExplicitSavedItemAction({
      interactionId: "browser-interaction",
      inputMode: "typed",
      originalText: "Keep this note",
    });
    expect(captureExplicitSavedItem).toHaveBeenCalledWith({
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
    await changeExplicitSavedItemCaptureAction({
      savedItemId: SAVED_ITEM_ID,
      originalText: "Corrected note",
    });
    expect(changeExplicitSavedItemCapture).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: SAVED_ITEM_ID,
      originalText: "Corrected note",
    });

    await undoExplicitSavedItemCaptureAction({ savedItemId: SAVED_ITEM_ID });
    expect(undoExplicitSavedItemCapture).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: SAVED_ITEM_ID,
    });
  });
});
