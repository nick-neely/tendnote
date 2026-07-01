import { beforeEach, describe, expect, it, vi } from "vitest";

// The boundary composes shared db seams; mock them so the test exercises the
// connection+approval gate and the write-through edit, not the real database.
const getDraft = vi.fn();
const editDraftBody = vi.fn();
const isProviderCapabilityConnected = vi.fn();
const createGmailDraft = vi.fn();
const retryGmailDraftAction = vi.fn();
let capturedAuthorize: ((input: unknown) => Promise<{ ok: boolean; reason?: string }>) | null =
  null;

// `server-only` throws outside an RSC bundle; stub it so the boundary loads in tests.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: async () => "user-1",
}));
vi.mock("@tendnote/db/queries/drafts", () => ({
  getDraft: (...args: unknown[]) => getDraft(...args),
  editDraftBody: (...args: unknown[]) => editDraftBody(...args),
}));
vi.mock("@tendnote/db/queries/provider-connections", () => ({
  isProviderCapabilityConnected: (...args: unknown[]) => isProviderCapabilityConnected(...args),
}));
vi.mock("@tendnote/db/queries/gmail-drafts", () => ({
  createDefaultGoogleGmailDraftService: (opts: {
    authorize: (input: unknown) => Promise<{ ok: boolean; reason?: string }>;
  }) => {
    // Capture the gate so we can drive it through the real service contract: the
    // service invokes `authorize` and blocks when it denies.
    capturedAuthorize = opts.authorize;
    return {
      createGmailDraft: async (input: { messageDraftId: string; recipient: unknown }) => {
        const gate = await opts.authorize({
          ownerUserId: "user-1",
          messageDraftId: input.messageDraftId,
          kind: "create",
        });
        if (!gate.ok) {
          return { status: "blocked", reason: gate.reason };
        }
        createGmailDraft(input);
        return { status: "succeeded", action: { id: "act-1", recipient: input.recipient } };
      },
      retryGmailDraftAction: (input: unknown) => {
        retryGmailDraftAction(input);
        return { status: "succeeded", action: { id: "act-1" } };
      },
    };
  },
}));

import { createOwnerGmailDraft } from "./gmail-drafts";

const RECIPIENT = {
  email: "casey@example.com",
  source: "manual_entry" as const,
  contactMethodId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedAuthorize = null;
  isProviderCapabilityConnected.mockResolvedValue(true);
  getDraft.mockResolvedValue({
    id: "d1",
    personId: "p1",
    status: "approved",
    body: "Original body",
  });
});

describe("createOwnerGmailDraft gate", () => {
  it("blocks when Gmail is not connected", async () => {
    isProviderCapabilityConnected.mockResolvedValue(false);
    const { outcome } = await createOwnerGmailDraft({
      draftId: "d1",
      recipient: RECIPIENT,
      subject: "Hi",
    });
    expect(outcome).toEqual({ status: "blocked", reason: "Gmail isn't connected." });
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("blocks when the Tendnote draft is not approved", async () => {
    getDraft.mockResolvedValue({
      id: "d1",
      personId: "p1",
      status: "draft",
      body: "Original body",
    });
    const { outcome } = await createOwnerGmailDraft({
      draftId: "d1",
      recipient: RECIPIENT,
      subject: "Hi",
    });
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toMatch(/approve/i);
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("creates when connected and approved, returning the person id for revalidation", async () => {
    const { outcome, personId } = await createOwnerGmailDraft({
      draftId: "d1",
      recipient: RECIPIENT,
      subject: "Hi",
    });
    expect(outcome.status).toBe("succeeded");
    expect(personId).toBe("p1");
    expect(createGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "create:d1", recipient: RECIPIENT }),
    );
    expect(capturedAuthorize).not.toBeNull();
  });
});

describe("createOwnerGmailDraft input confirmation", () => {
  it("requires a confirmed recipient — rejects a blank/invalid address", async () => {
    await expect(
      createOwnerGmailDraft({
        draftId: "d1",
        recipient: { email: "", source: "manual_entry", contactMethodId: null },
        subject: "Hi",
      }),
    ).rejects.toThrow();
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("requires an approved subject — rejects a blank subject", async () => {
    await expect(
      createOwnerGmailDraft({ draftId: "d1", recipient: RECIPIENT, subject: "   " }),
    ).rejects.toThrow();
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("keeps a manually entered recipient action-specific (no silent contact save)", async () => {
    await createOwnerGmailDraft({ draftId: "d1", recipient: RECIPIENT, subject: "Hi" });
    // The recipient reaches the write as a manual entry with no contact-method id, so
    // it can never be promoted to a durable contact method (ADR-0085).
    expect(createGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: { email: "casey@example.com", source: "manual_entry", contactMethodId: null },
      }),
    );
  });
});

describe("createOwnerGmailDraft write-through", () => {
  it("persists a changed last-mile body through the draft lifecycle before the write", async () => {
    await createOwnerGmailDraft({
      draftId: "d1",
      recipient: RECIPIENT,
      subject: "Hi",
      bodyEdit: "Edited body",
    });
    expect(editDraftBody).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      draftId: "d1",
      body: "Edited body",
    });
    expect(createGmailDraft).toHaveBeenCalled();
  });

  it("does not write through an unchanged body", async () => {
    await createOwnerGmailDraft({
      draftId: "d1",
      recipient: RECIPIENT,
      subject: "Hi",
      bodyEdit: "Original body",
    });
    expect(editDraftBody).not.toHaveBeenCalled();
  });
});
