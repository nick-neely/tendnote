import type { GmailDraftRecipient } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createFailingGmailDraftAdapter, createFakeGmailDraftAdapter } from "./fake-adapter";
import { createInMemoryGmailDraftActionStore } from "./in-memory-store";
import { createGmailDraftService } from "./service";
import type { GmailDraftAuthorize, GmailDraftBodySource } from "./types";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";
const DRAFT_ID = "draft-1";

const RECIPIENT: GmailDraftRecipient = {
  email: "casey@example.com",
  source: "manual_entry",
  contactMethodId: null,
};

const CONTACT_RECIPIENT: GmailDraftRecipient = {
  email: "casey@example.com",
  source: "contact_method",
  contactMethodId: "cm-1",
};

/** Fake draft body source: the Tendnote draft row remains the source of truth. */
function bodySource(bodies: Record<string, string>): GmailDraftBodySource {
  return {
    async getDraftBody({ messageDraftId }) {
      const body = bodies[messageDraftId];
      return body === undefined ? null : { body };
    },
  };
}

function setup(
  overrides: {
    adapter?: ReturnType<typeof createFakeGmailDraftAdapter>;
    authorize?: GmailDraftAuthorize;
    bodies?: Record<string, string>;
  } = {},
) {
  const store = createInMemoryGmailDraftActionStore();
  const adapter = overrides.adapter ?? createFakeGmailDraftAdapter({ draftId: "gmail-1" });
  const service = createGmailDraftService({
    store,
    adapter,
    drafts: bodySource(overrides.bodies ?? { [DRAFT_ID]: "Hey Casey, great to reconnect!" }),
    authorize: overrides.authorize,
  });
  return { store, adapter, service };
}

function writeInput(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: OWNER,
    messageDraftId: DRAFT_ID,
    subject: "Great catching up",
    recipient: RECIPIENT,
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("gmail draft creation", () => {
  it("creates a Gmail draft from an approved Tendnote draft and stores the draft id", async () => {
    const { service, adapter, store } = setup();

    const outcome = await service.createGmailDraft(writeInput());

    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.action.gmailDraftId).toBe("gmail-1");
    expect(outcome.action.kind).toBe("create");
    expect(outcome.action.version).toBe(1);
    // The adapter received the exact persisted draft body, subject, and recipient.
    expect(adapter.createCalls).toEqual([
      {
        ownerUserId: OWNER,
        to: "casey@example.com",
        subject: "Great catching up",
        body: "Hey Casey, great to reconnect!",
      },
    ]);
    const audit = await store.listAuditLogEntries({ ownerUserId: OWNER });
    expect(audit.map((entry) => entry.action)).toContain("gmail_draft_action.create");
  });

  it("stores only minimized non-secret state and never the message body", async () => {
    const { service, store } = setup();

    const outcome = await service.createGmailDraft(writeInput({ recipient: CONTACT_RECIPIENT }));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;

    // The persisted record carries only the minimized fields — no body, no payload.
    const persisted = JSON.stringify(outcome.action);
    expect(persisted).not.toContain("great to reconnect");
    expect(Object.keys(outcome.action).sort()).toEqual(
      [
        "capabilityKey",
        "createdAt",
        "gmailDraftId",
        "id",
        "idempotencyKey",
        "kind",
        "lastErrorMessage",
        "messageDraftId",
        "ownerUserId",
        "providerKey",
        "recipient",
        "status",
        "subject",
        "updatedAt",
        "version",
      ].sort(),
    );
    expect(outcome.action.recipient.contactMethodId).toBe("cm-1");
    expect(outcome.action.providerKey).toBe("google");
    expect(outcome.action.capabilityKey).toBe("gmail");
    void store;
  });

  it("is idempotent: the same submission key never writes Gmail twice", async () => {
    const { service, adapter } = setup();

    const first = await service.createGmailDraft(writeInput());
    const second = await service.createGmailDraft(writeInput());

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    if (first.status !== "succeeded" || second.status !== "succeeded") return;
    expect(second.action.id).toBe(first.action.id);
    expect(adapter.createCalls).toHaveLength(1);
  });

  it("refuses a duplicate create once a Gmail draft already exists for the draft", async () => {
    const { service, adapter } = setup();

    await service.createGmailDraft(writeInput({ idempotencyKey: "idem-1" }));
    const duplicate = await service.createGmailDraft(writeInput({ idempotencyKey: "idem-2" }));

    expect(duplicate.status).toBe("blocked");
    if (duplicate.status !== "blocked") return;
    expect(duplicate.reason).toMatch(/already exists/i);
    // No second external write happened.
    expect(adapter.createCalls).toHaveLength(1);
  });

  it("blocks the write when the precondition gate denies (not connected / not approved)", async () => {
    const { service, adapter, store } = setup({
      authorize: async () => ({ ok: false, reason: "Gmail is not connected." }),
    });

    const outcome = await service.createGmailDraft(writeInput());

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toBe("Gmail is not connected.");
    // Blocked leaves no external write and no durable action row.
    expect(adapter.createCalls).toHaveLength(0);
    expect(
      await store.listActionsForDraft({ ownerUserId: OWNER, messageDraftId: DRAFT_ID }),
    ).toHaveLength(0);
  });
});

describe("gmail draft failure and retry", () => {
  it("records a visible, retryable failure with a non-secret error and no draft id", async () => {
    const store = createInMemoryGmailDraftActionStore();
    const service = createGmailDraftService({
      store,
      adapter: createFailingGmailDraftAdapter(new Error("gmail 503 unavailable")),
      drafts: bodySource({ [DRAFT_ID]: "Body text" }),
    });

    const outcome = await service.createGmailDraft(writeInput());

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.action.gmailDraftId).toBeNull();
    expect(outcome.action.status).toBe("failed");
    expect(outcome.action.lastErrorMessage).toBe("gmail 503 unavailable");
  });

  it("retries a failed action on the same record and succeeds without duplicating", async () => {
    // First attempt fails, then a retry against a working adapter succeeds.
    const store = createInMemoryGmailDraftActionStore();
    const failing = createGmailDraftService({
      store,
      adapter: createFailingGmailDraftAdapter(),
      drafts: bodySource({ [DRAFT_ID]: "Body text" }),
    });
    const failed = await failing.createGmailDraft(writeInput());
    expect(failed.status).toBe("failed");
    if (failed.status !== "failed") return;

    const working = createGmailDraftService({
      store,
      adapter: createFakeGmailDraftAdapter({ draftId: "gmail-retry" }),
      drafts: bodySource({ [DRAFT_ID]: "Body text" }),
    });
    const retried = await working.retryGmailDraftAction({
      ownerUserId: OWNER,
      actionId: failed.action.id,
    });

    expect(retried.status).toBe("succeeded");
    if (retried.status !== "succeeded") return;
    expect(retried.action.id).toBe(failed.action.id);
    expect(retried.action.gmailDraftId).toBe("gmail-retry");
    expect(retried.action.lastErrorMessage).toBeNull();
    // Exactly one durable action row exists for the draft.
    expect(
      await store.listActionsForDraft({ ownerUserId: OWNER, messageDraftId: DRAFT_ID }),
    ).toHaveLength(1);
  });
});

describe("gmail draft update", () => {
  it("updates the existing Gmail draft id instead of creating a duplicate", async () => {
    const { service, adapter } = setup();
    const created = await service.createGmailDraft(writeInput({ idempotencyKey: "create" }));
    expect(created.status).toBe("succeeded");

    const updated = await service.updateGmailDraft(
      writeInput({ idempotencyKey: "update", subject: "Revised subject" }),
    );

    expect(updated.status).toBe("succeeded");
    if (updated.status !== "succeeded") return;
    expect(updated.action.kind).toBe("update");
    expect(updated.action.gmailDraftId).toBe("gmail-1");
    expect(updated.action.version).toBe(2);
    expect(adapter.updateCalls).toEqual([
      {
        ownerUserId: OWNER,
        to: "casey@example.com",
        subject: "Revised subject",
        body: "Hey Casey, great to reconnect!",
        gmailDraftId: "gmail-1",
      },
    ]);
  });

  it("rejects reusing a create's idempotency key for an update (no silent skip)", async () => {
    const { service } = setup();
    await service.createGmailDraft(writeInput({ idempotencyKey: "shared" }));

    // Reusing the create key on an update must not silently return the create.
    await expect(
      service.updateGmailDraft(writeInput({ idempotencyKey: "shared", subject: "Revised" })),
    ).rejects.toThrow(/different Gmail draft action/i);
  });

  it("blocks an update when no Gmail draft exists for the draft yet", async () => {
    const { service } = setup();

    const outcome = await service.updateGmailDraft(writeInput({ idempotencyKey: "update-only" }));

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") return;
    expect(outcome.reason).toMatch(/no gmail draft/i);
  });
});

describe("gmail draft owner scoping", () => {
  it("does not read or retry another owner's action", async () => {
    const { service, store } = setup();
    const created = await service.createGmailDraft(writeInput());
    expect(created.status).toBe("succeeded");
    if (created.status !== "succeeded") return;

    expect(
      await store.getAction({ ownerUserId: OTHER_OWNER, actionId: created.action.id }),
    ).toBeNull();
    await expect(
      service.retryGmailDraftAction({ ownerUserId: OTHER_OWNER, actionId: created.action.id }),
    ).rejects.toThrow(/not found/i);
  });

  it("does not surface another owner's actions when listing a draft", async () => {
    const { service, store } = setup();
    await service.createGmailDraft(writeInput());

    expect(
      await store.listActionsForDraft({ ownerUserId: OTHER_OWNER, messageDraftId: DRAFT_ID }),
    ).toHaveLength(0);
  });
});

describe("gmail draft adapter boundary", () => {
  it("exposes only draft create/update — never a send/read path (ADR-0089)", () => {
    const adapter = createFakeGmailDraftAdapter();
    // The adapter is structurally incapable of sending or reading the mailbox.
    expect(Object.keys(adapter).sort()).toEqual(
      ["createCalls", "createDraft", "updateCalls", "updateDraft"].sort(),
    );
    // No send/read-shaped methods exist on the adapter surface.
    for (const key of Object.keys(adapter)) {
      expect(key).not.toMatch(/send|list|get|read|history|thread|message/i);
    }
  });
});
