import {
  gmailDraftActionSchema,
  gmailDraftRecipientSchema,
  suggestGmailSubject,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createFailingGmailDraftAdapter, createFakeGmailDraftAdapter } from "./fake-adapter";
import { createGoogleGmailDraftAdapter } from "./google-adapter";
import { createInMemoryGmailDraftActionStore } from "./in-memory-store";
import { createGmailDraftService } from "./service";

/**
 * Structural + behavioral Phase 2D Gmail policy (PRD #119, ADRs 0088/0089/0091/0094/
 * 0095/0097). These pin the boundary the source scan cannot prove: the adapter is
 * draft create/update only (no send/read), the recipient is a single `to` (no
 * CC/BCC), the persisted action carries no body/payload, Gmail updates happen only
 * on explicit current intent, and a failed write is a visible retryable state that is
 * never retried automatically.
 */

const RECIPIENT = {
  email: "casey@example.com",
  source: "manual_entry" as const,
  contactMethodId: null,
};

/** A Gmail service over in-memory state with an always-approved gate, for behavior. */
function serviceWith(adapter: ReturnType<typeof createFakeGmailDraftAdapter>) {
  const store = createInMemoryGmailDraftActionStore();
  const service = createGmailDraftService({
    store,
    adapter,
    drafts: { getDraftBody: async () => ({ body: "Approved body" }) },
  });
  return { store, service };
}

describe("Gmail adapter surface is draft create/update only (no send/read)", () => {
  it("exposes exactly createDraft and updateDraft on the live adapter", () => {
    const live = createGoogleGmailDraftAdapter({ getAccessToken: async () => "t" });
    expect(Object.keys(live).sort()).toEqual(["createDraft", "updateDraft"]);
  });

  it("adds only recording arrays to the fake adapter - no send/read method", () => {
    const fake = createFakeGmailDraftAdapter();
    expect(Object.keys(fake).sort()).toEqual(
      ["createCalls", "createDraft", "updateCalls", "updateDraft"].sort(),
    );
  });
});

describe("first Gmail slice is to/subject/body only (ADR-0095)", () => {
  it("keeps a single `to` recipient - a CC/BCC/attachment field is not part of the shape", () => {
    const parsed = gmailDraftRecipientSchema.parse({
      email: "casey@example.com",
      source: "manual_entry",
      cc: "other@example.com",
      bcc: "hidden@example.com",
      attachments: ["file.pdf"],
    } as never);
    // The recipient shape has no CC/BCC/attachment fields; extra keys never survive.
    expect(Object.keys(parsed).sort()).toEqual(["contactMethodId", "email", "source"]);
  });

  it("keeps no body or raw payload on the action-record shape (ADR-0094)", () => {
    const action = gmailDraftActionSchema.parse({
      id: "a",
      ownerUserId: "u",
      messageDraftId: "d",
      providerKey: "google",
      capabilityKey: "gmail",
      kind: "create",
      status: "succeeded",
      subject: "Hi",
      recipient: RECIPIENT,
      gmailDraftId: "g",
      version: 1,
      idempotencyKey: "k",
      lastErrorMessage: null,
      body: "secret body",
      rawPayload: { thread: "t" },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    // The action shape has no body/payload field (the body stays on message_drafts).
    expect(Object.keys(action)).not.toContain("body");
    expect(Object.keys(action)).not.toContain("rawPayload");
  });
});

describe("Gmail updates require current user intent (ADR-0088)", () => {
  it("never updates Gmail off a local draft change - only on an explicit update call", async () => {
    const adapter = createFakeGmailDraftAdapter({ draftId: "g1" });
    const { store, service } = serviceWith(adapter);

    await service.createGmailDraft({
      ownerUserId: "u",
      messageDraftId: "d",
      subject: "Hi",
      recipient: RECIPIENT,
      idempotencyKey: "create:d",
    });

    // No update happens on its own: the only actions are the create, and the adapter
    // never received an update, until an explicit updateGmailDraft is called.
    expect(adapter.updateCalls).toHaveLength(0);
    let actions = await store.listActionsForDraft({ ownerUserId: "u", messageDraftId: "d" });
    expect(actions.map((a) => a.kind)).toEqual(["create"]);

    await service.updateGmailDraft({
      ownerUserId: "u",
      messageDraftId: "d",
      subject: "Revised",
      recipient: RECIPIENT,
      idempotencyKey: "update:d:1",
    });
    expect(adapter.updateCalls).toHaveLength(1);
    actions = await store.listActionsForDraft({ ownerUserId: "u", messageDraftId: "d" });
    expect(actions.some((a) => a.kind === "update")).toBe(true);
  });
});

describe("failed Gmail writes are a visible, explicit-retry-only state (ADR-0091)", () => {
  it("records a retryable failure and never retries automatically in the background", async () => {
    const failing = createFailingGmailDraftAdapter();
    const createDraft = vi.spyOn(failing, "createDraft");
    const store = createInMemoryGmailDraftActionStore();
    const service = createGmailDraftService({
      store,
      adapter: failing,
      drafts: { getDraftBody: async () => ({ body: "Approved body" }) },
    });

    const outcome = await service.createGmailDraft({
      ownerUserId: "u",
      messageDraftId: "d",
      subject: "Hi",
      recipient: RECIPIENT,
      idempotencyKey: "create:d",
    });

    // The failure is a durable, visible, retryable state...
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.action.status).toBe("failed");
    expect(outcome.action.lastErrorMessage).not.toBeNull();
    // ...and the adapter was called exactly once: no background auto-retry.
    expect(createDraft).toHaveBeenCalledTimes(1);

    // Recovery is an EXPLICIT retry on the same record (no duplicate write).
    const working = createFakeGmailDraftAdapter({ draftId: "g1" });
    const recovered = createGmailDraftService({
      store,
      adapter: working,
      drafts: { getDraftBody: async () => ({ body: "Approved body" }) },
    });
    const retried = await recovered.retryGmailDraftAction({
      ownerUserId: "u",
      actionId: outcome.action.id,
    });
    expect(retried.status).toBe("succeeded");
    expect(
      (await store.listActionsForDraft({ ownerUserId: "u", messageDraftId: "d" })).length,
    ).toBe(1);
  });
});

describe("subject suggestion is deterministic (no model-backed generation)", () => {
  it("returns the same subject for the same input every time", () => {
    const input = { purpose: "check_in" as const, personName: "Casey" };
    expect(suggestGmailSubject(input)).toBe(suggestGmailSubject(input));
  });
});
