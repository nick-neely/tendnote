import { ConversationalCaptureUndoError } from "@tendnote/domain/conversational-capture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, toolModelValue } from "./test-tool";

/**
 * What Eve is allowed to *say* happened to a just-made capture.
 *
 * Both correction tools used to answer with a fixed success: Undo hardcoded
 * `undone: true` and Change computed `changed: !clarification`. So "that was
 * already undone", "that record is gone", "Tendnote will not invert this", and
 * "the confirmation did not parse" all reached the model as a completed change,
 * and the model told the user it had done something it had not. These pin the
 * branch reporting rather than the wording of any one sentence.
 */
const {
  changeExplicitCaptureOutcome,
  requestBackgroundAffectedScopeReconciliation,
  undoExplicitCaptureOutcome,
} = vi.hoisted(() => ({
  changeExplicitCaptureOutcome: vi.fn(),
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
  undoExplicitCaptureOutcome: vi.fn(),
}));

vi.mock("@tendnote/db/queries/conversational-capture", () => ({
  captureExplicitOutcome: vi.fn(),
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawChangeTool } = await import("../agent/tools/change_saved_item_capture");
const { default: rawUndoTool } = await import("../agent/tools/undo_saved_item_capture");
const changeTool = asTestTool(rawChangeTool);
const undoTool = asTestTool(rawUndoTool);

const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;
const SAVED_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const UNDO_TARGET = { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID } as const;
const CHANGE_TARGET = { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID } as const;
const CONFIRMATION = {
  destination: "Saved Items",
  groundedBySourceRecordId: "source-1",
  interpreted: { kind: "Note", visibility: "Only me" },
  change: CHANGE_TARGET,
} as const;

beforeEach(() => vi.clearAllMocks());

describe("undo_saved_item_capture reports the Undo that actually happened", () => {
  it("confirms an inverse that ran now and reconciles its scopes", async () => {
    undoExplicitCaptureOutcome.mockResolvedValue({
      outcome: "undone",
      result: { id: SAVED_ITEM_ID, status: "archived" },
      affectedScopes: [{ kind: "owner-collection", collection: "saved-items", ownerUserId: "o" }],
    });

    const output = await undoTool.execute({ target: UNDO_TARGET }, ctx);

    expect(output.outcome).toBe("undone");
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([
      { kind: "owner-collection", collection: "saved-items", ownerUserId: "o" },
    ]);
    expect(toolModelValue(undoTool, output).guidance).toMatch(/authoritatively undone/);
  });

  it("does not report a fresh Undo when the capture was already undone", async () => {
    undoExplicitCaptureOutcome.mockResolvedValue({
      outcome: "already_undone",
      result: { id: SAVED_ITEM_ID, status: "archived" },
      affectedScopes: [],
    });

    const output = await undoTool.execute({ target: UNDO_TARGET }, ctx);

    expect(output.outcome).toBe("already_undone");
    const value = toolModelValue(undoTool, output);
    expect(value.guidance).toMatch(/already undone/i);
    expect(value.guidance).toMatch(/do not call Undo again/i);
    // The no-op affects nothing, so nothing is queued for cache reconciliation.
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([]);
  });

  it("reports a missing record as not undone, carrying the store's curated sentence", async () => {
    undoExplicitCaptureOutcome.mockRejectedValue(
      new ConversationalCaptureUndoError("not_found", "That Saved Item is no longer available."),
    );

    const output = await undoTool.execute({ target: UNDO_TARGET }, ctx);

    expect(output.outcome).toBe("not_found");
    expect(output.reason).toBe("That Saved Item is no longer available.");
    expect(toolModelValue(undoTool, output).guidance).toMatch(/Nothing was undone/);
  });

  it("reports a refusal as not undone rather than as a completed Undo", async () => {
    undoExplicitCaptureOutcome.mockRejectedValue(
      new ConversationalCaptureUndoError(
        "refused",
        "A captured Person has no safe Undo operation.",
      ),
    );

    const output = await undoTool.execute({ target: UNDO_TARGET }, ctx);

    expect(output.outcome).toBe("refused");
    expect(toolModelValue(undoTool, output).guidance).toMatch(/Nothing was undone/);
  });

  it("keeps an infrastructure failure opaque and out of the result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    undoExplicitCaptureOutcome.mockRejectedValue(
      new Error('Failed query: select * from "saved_items" params: secret'),
    );

    const failure = undoTool.execute({ target: UNDO_TARGET }, ctx);

    await expect(failure).rejects.toThrow("Could not read the user's records right now.");
    await expect(failure).rejects.not.toThrow(/saved_items|secret|select/i);
  });
});

describe("change_saved_item_capture separates a real change from a failed read", () => {
  it("reports a change only when the correction came back with a confirmation", async () => {
    changeExplicitCaptureOutcome.mockResolvedValue({ confirmation: CONFIRMATION });

    const output = await changeTool.execute(
      { originalText: "Corrected filter note", target: CHANGE_TARGET },
      ctx,
    );

    expect(output.changed).toBe(true);
    expect(toolModelValue(changeTool, output).changed).toBe(true);
  });

  it("reports a clarification as not changed", async () => {
    changeExplicitCaptureOutcome.mockResolvedValue({
      clarification: {
        field: "timing",
        question: "When should this come back?",
        sourceRecordId: "source-1",
      },
    });

    const output = await changeTool.execute(
      { originalText: "Corrected filter note", target: CHANGE_TARGET },
      ctx,
    );

    expect(output.changed).toBe(false);
    expect(toolModelValue(changeTool, output).clarification).toBe("When should this come back?");
  });

  it("fails loudly when the correction returned neither branch, instead of claiming a change", async () => {
    // The exact shape the old `changed: !clarification` read as success.
    changeExplicitCaptureOutcome.mockResolvedValue({ id: SAVED_ITEM_ID, sourceRecordId: "s" });

    await expect(
      changeTool.execute({ originalText: "Corrected filter note", target: CHANGE_TARGET }, ctx),
    ).rejects.toThrow(/did not complete and nothing was changed/);
  });

  it("fails loudly when a clarification came back unreadable", async () => {
    changeExplicitCaptureOutcome.mockResolvedValue({ clarification: { question: "" } });

    await expect(
      changeTool.execute({ originalText: "Corrected filter note", target: CHANGE_TARGET }, ctx),
    ).rejects.toThrow(/was not applied/);
  });

  it("still reports the committed change when only its confirmation is unreadable", async () => {
    // The write landed; only the description of it is unusable. Reporting a failure
    // here would be as wrong as the old false success, in the other direction.
    changeExplicitCaptureOutcome.mockResolvedValue({ confirmation: { destination: "Nowhere" } });

    const output = await changeTool.execute(
      { originalText: "Corrected filter note", target: CHANGE_TARGET },
      ctx,
    );

    expect(output).toMatchObject({ changed: true, confirmation: null });
    expect(toolModelValue(changeTool, output).guidance).toMatch(/no readable description/);
  });
});
