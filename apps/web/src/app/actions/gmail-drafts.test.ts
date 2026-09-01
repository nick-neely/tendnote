import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const { createOwnerGmailDraft, retryOwnerGmailDraft, updateOwnerGmailDraft } = vi.hoisted(() => ({
  createOwnerGmailDraft: vi.fn(),
  retryOwnerGmailDraft: vi.fn(),
  updateOwnerGmailDraft: vi.fn(),
}));

vi.mock("@/lib/integrations/gmail-drafts", () => ({
  createOwnerGmailDraft,
  retryOwnerGmailDraft,
  updateOwnerGmailDraft,
}));

import {
  createGmailDraftAction,
  retryGmailDraftAction,
  updateGmailDraftAction,
} from "./gmail-drafts";

const DRAFT_ID = randomUUID();
const ACTION_ID = randomUUID();
const PERSON_ID = randomUUID();
const RECIPIENT = {
  email: "casey@example.com",
  source: "manual_entry" as const,
  contactMethodId: null,
};
const DRAFT_SCOPE = {
  kind: "viewer-entity" as const,
  entity: "person" as const,
  entityId: PERSON_ID,
  viewerUserId: "owner-1",
};
const SUCCEEDED = {
  status: "succeeded" as const,
  action: {
    id: ACTION_ID,
    kind: "create" as const,
    ownerUserId: "owner-1",
    messageDraftId: DRAFT_ID,
    providerKey: "google" as const,
    capabilityKey: "gmail" as const,
    recipient: RECIPIENT,
    subject: "Checking in",
    gmailDraftId: "gmail-1",
    version: 1,
    idempotencyKey: "create:draft",
    status: "succeeded" as const,
    lastErrorMessage: null,
    createdAt: new Date("2026-07-28T12:00:00Z"),
    updatedAt: new Date("2026-07-28T12:00:00Z"),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  const result = {
    outcome: SUCCEEDED,
    personId: PERSON_ID,
    affectedScopes: [DRAFT_SCOPE],
  };
  createOwnerGmailDraft.mockResolvedValue(result);
  updateOwnerGmailDraft.mockResolvedValue(result);
  retryOwnerGmailDraft.mockResolvedValue(result);
});

describe("Gmail draft server actions", () => {
  it("runs admission before validation and never calls the integration for invalid input", async () => {
    await expect(
      createGmailDraftAction({
        draftId: "not-a-uuid",
        subject: "Checking in",
        recipient: RECIPIENT,
      }),
    ).resolves.toMatchObject({ ok: false });

    expect(requireAdmittedOwnerForActionSpy).toHaveBeenCalledOnce();
    expect(createOwnerGmailDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["create", createGmailDraftAction, createOwnerGmailDraft],
    ["update", updateGmailDraftAction, updateOwnerGmailDraft],
  ])(
    "runs %s through the owner-action seam and reconciles returned scopes",
    async (_, action, write) => {
      const result = await action({
        draftId: DRAFT_ID,
        subject: "Checking in",
        recipient: RECIPIENT,
        bodyEdit: "How have you been?",
      });

      expect(write).toHaveBeenCalledWith({
        ownerUserId: "owner-1",
        draftId: DRAFT_ID,
        subject: "Checking in",
        recipient: RECIPIENT,
        bodyEdit: "How have you been?",
      });
      expect(result).toMatchObject({ ok: true, view: { status: "succeeded" } });
      expect(updateTagSpy).toHaveBeenCalledWith("people:owner:owner-1");
      expect(updateTagSpy).toHaveBeenCalledWith(`people:owner:owner-1:person:${PERSON_ID}`);
      expect(updateTagSpy).toHaveBeenCalledWith(`people:visible-person:${PERSON_ID}`);
    },
  );

  it("runs retry through the same owner-action seam", async () => {
    const result = await retryGmailDraftAction({ draftId: DRAFT_ID, actionId: ACTION_ID });

    expect(retryOwnerGmailDraft).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      draftId: DRAFT_ID,
      actionId: ACTION_ID,
    });
    expect(result).toMatchObject({ ok: true, view: { status: "succeeded" } });
  });
});
