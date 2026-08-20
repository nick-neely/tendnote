import { MessageDraftValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, toolModelValue } from "./test-tool";

const { editDraftBody, dismissDraft } = vi.hoisted(() => ({
  editDraftBody: vi.fn(),
  dismissDraft: vi.fn(),
}));
vi.mock("@tendnote/db/queries/drafts", () => ({ editDraftBody, dismissDraft }));

const { requestBackgroundAffectedScopeReconciliation } = vi.hoisted(() => ({
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawEditTool } = await import("../agent/tools/edit_draft_body");
const { default: rawDismissTool } = await import("../agent/tools/dismiss_draft");
const editTool = asTestTool(rawEditTool);
const dismissTool = asTestTool(rawDismissTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const SCOPES = [{ kind: "viewer-collection", collection: "drafts", viewerUserId: "user-1" }];

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    personId: PERSON_ID,
    channel: "text",
    purpose: "check_in",
    status: "draft",
    body: "SECRET_DRAFT_BODY",
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("edit_draft_body", () => {
  it("writes the body for the session's owner and reconciles the scopes", async () => {
    editDraftBody.mockResolvedValue({ result: draft(), affectedScopes: SCOPES });

    await editTool.execute({ draftId: DRAFT_ID, body: "Shorter version" }, ctx);

    expect(editDraftBody).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      draftId: DRAFT_ID,
      body: "Shorter version",
    });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith(SCOPES);
  });

  it("takes a draft id and a body, and nothing that could change its status", async () => {
    // ADR 0088 keeps approval with the user. This tool edits text: the seam it calls has
    // no status argument, and the schema offers the model nothing to set one with.
    const shape = Object.keys(
      (editTool.inputSchema as { shape: Record<string, unknown> }).shape,
    ).sort();

    expect(shape).toEqual(["body", "draftId"]);
  });

  it("returns the persisted status so an edit cannot read as an approval", async () => {
    editDraftBody.mockResolvedValue({ result: draft(), affectedScopes: [] });

    const output = await editTool.execute({ draftId: DRAFT_ID, body: "Shorter version" }, ctx);
    const value = toolModelValue(editTool, output);

    expect(value.status).toBe("draft");
    // The body does not come back - the model just wrote it, and echoing it invites a
    // reply that reprints the whole message.
    expect(JSON.stringify(value)).not.toContain("SECRET_DRAFT_BODY");
    expect(JSON.stringify(value)).not.toContain(PERSON_ID);
    expect(value.guidance).toMatch(/internal Tendnote draft/i);
    expect(value.guidance).toMatch(/remains an unapproved draft/i);
    expect(value.guidance).toMatch(/nothing was approved, exported, or sent/i);
    expect(value.guidance).toMatch(/not an external or Gmail draft/i);
    expect(value.guidance).not.toMatch(/ready to send/i);
  });

  it("does not imply a prior approval still covers edited wording", async () => {
    editDraftBody.mockResolvedValue({ result: draft({ status: "approved" }), affectedScopes: [] });

    const output = await editTool.execute({ draftId: DRAFT_ID, body: "Updated wording" }, ctx);
    const value = toolModelValue(editTool, output);

    expect(value.status).toBe("approved");
    expect(value.guidance).toMatch(/prior approval no longer covers/i);
    expect(value.guidance).toMatch(/nothing was exported or sent/i);
    expect(value.guidance).not.toMatch(/remains an unapproved draft/i);
  });

  it("curates a store failure instead of handing the model raw SQL", async () => {
    editDraftBody.mockRejectedValue(new Error('Failed query: update "message_drafts" ...'));

    await expect(
      editTool.execute({ draftId: DRAFT_ID, body: "Shorter version" }, ctx),
    ).rejects.toThrow(/Could not read the user's records right now/);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });

  it("passes a curated draft refusal through in the domain's own words", async () => {
    // A draft the user dismissed or already sent is finished with, and the shared
    // lifecycle refuses to edit it. That refusal is a fact about the user's own record
    // and fixable by them, so it now travels as a `MessageDraftValidationError` and
    // reaches the model as itself - where it used to be flattened into the opaque store
    // sentence and Eve could only say "that didn't work".
    editDraftBody.mockRejectedValue(
      new MessageDraftValidationError("Cannot edit a draft that is sent_manually."),
    );

    await expect(
      editTool.execute({ draftId: DRAFT_ID, body: "Shorter version" }, ctx),
    ).rejects.toThrow(/cannot edit a draft that is sent_manually/i);
  });

  it("still swallows a missing draft, so a bad id cannot start a guessing loop", async () => {
    // Deliberately NOT curated: a missing record is the failure that taught Eve to try
    // another id, and the opaque sentence is the one that terminates it.
    editDraftBody.mockRejectedValue(new Error("Message draft not found."));

    await expect(
      editTool.execute({ draftId: DRAFT_ID, body: "Shorter version" }, ctx),
    ).rejects.toThrow(/Could not read the user's records right now/);
  });
});

describe("dismiss_draft", () => {
  it("dismisses for the session's owner and reconciles the scopes", async () => {
    dismissDraft.mockResolvedValue({
      result: draft({ status: "dismissed" }),
      affectedScopes: SCOPES,
    });

    const output = await dismissTool.execute({ draftId: DRAFT_ID }, ctx);

    expect(dismissDraft).toHaveBeenCalledWith({ ownerUserId: "user-1", draftId: DRAFT_ID });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith(SCOPES);
    expect(output.status).toBe("dismissed");
  });

  it("reports the persisted status and hands back neither the message nor an id", async () => {
    dismissDraft.mockResolvedValue({ result: draft({ status: "dismissed" }), affectedScopes: [] });

    const output = await dismissTool.execute({ draftId: DRAFT_ID }, ctx);
    const value = toolModelValue(dismissTool, output);

    expect(value.status).toBe("dismissed");
    expect(JSON.stringify(value)).not.toContain("SECRET_DRAFT_BODY");
    expect(JSON.stringify(value)).not.toContain(DRAFT_ID);
  });

  it("curates a store failure instead of handing the model raw SQL", async () => {
    dismissDraft.mockRejectedValue(new Error('Failed query: update "message_drafts" ...'));

    await expect(dismissTool.execute({ draftId: DRAFT_ID }, ctx)).rejects.toThrow(
      /Could not read the user's records right now/,
    );
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});
