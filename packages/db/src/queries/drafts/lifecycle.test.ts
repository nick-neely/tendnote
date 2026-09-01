import type { CreateMessageDraftInput, Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createGmailApprovalGate } from "../gmail-drafts/gate";
import { createInMemoryDraftLifecycleStore } from "./in-memory-store";
import { createDraftLifecycle } from "./lifecycle";
import type { InMemoryDraftLifecycleStore } from "./types";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

function draftInput(person: Person, overrides: Partial<CreateMessageDraftInput> = {}) {
  return {
    ownerUserId: OWNER,
    personId: person.id,
    channel: "text" as const,
    purpose: "check_in" as const,
    body: "Hey Mark — heard you moved to Denver, how's it going?",
    status: "draft" as const,
    sourceRefs: [
      {
        kind: "approved_memory" as const,
        id: "memory-1",
        label: "Moved to Denver",
        trust: "confirmed_fact" as const,
      },
    ],
    ...overrides,
  };
}

async function setup() {
  const store: InMemoryDraftLifecycleStore = createInMemoryDraftLifecycleStore();
  const lifecycle = createDraftLifecycle(store);

  const person = await store.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  const auditActions = async () =>
    (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { store, lifecycle, person, auditActions };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("draft lifecycle transitions", () => {
  it("approves a draft and audits the transition", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const approved = await ctx.lifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id });

    expect(approved.status).toBe("approved");
    expect(await ctx.auditActions()).toContain("message_draft.approve");
  });

  it("dismisses a draft", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const dismissed = await ctx.lifecycle.dismissDraft({ ownerUserId: OWNER, draftId: draft.id });

    expect(dismissed.status).toBe("dismissed");
    expect(await ctx.auditActions()).toContain("message_draft.dismiss");
  });

  it("marks a draft sent manually without implying Tendnote sent anything", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const sent = await ctx.lifecycle.markDraftSentManually({
      ownerUserId: OWNER,
      draftId: draft.id,
    });

    expect(sent.status).toBe("sent_manually");
    expect(await ctx.auditActions()).toContain("message_draft.mark_sent_manually");
  });

  it("rejects invalid transitions", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));
    await ctx.lifecycle.dismissDraft({ ownerUserId: OWNER, draftId: draft.id });

    // A dismissed draft cannot be approved.
    await expect(
      ctx.lifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id }),
    ).rejects.toThrow();
  });

  it("approves the exact body it read (guard passes when the body is unchanged)", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    // No concurrent edit: the persisted body still equals what approve reads, so the
    // optimistic-concurrency guard matches the row and approval lands.
    const approved = await ctx.lifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id });

    expect(approved.status).toBe("approved");
    expect(approved.body).toBe(draft.body);
    expect(await ctx.auditActions()).toContain("message_draft.approve");
  });

  it("refuses to approve a draft whose body changed between the approve's read and write (TOCTOU)", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    // Simulate a concurrent editDraftBody that commits AFTER approveDraft's pre-read:
    // requireDraft hands back the stale (original) body while the persisted row has
    // already moved to a body the user never approved. If the approve wrote
    // `approved` unconditionally, the Gmail gate would then authorize exporting that
    // unreviewed revision. The store's expectedBody guard must match no row and the
    // lifecycle must refuse.
    const racyStore: InMemoryDraftLifecycleStore = {
      ...ctx.store,
      async getDraft(input) {
        const current = await ctx.store.getDraft(input);
        if (!current) {
          return current;
        }
        // The persisted row races forward to an unapproved revision the instant
        // after this stale snapshot is read.
        await ctx.store.updateDraft({
          ownerUserId: input.ownerUserId,
          draftId: input.draftId,
          patch: { body: "Injected revision that raced in after the approve read." },
        });
        return current;
      },
    };
    const racyLifecycle = createDraftLifecycle(racyStore);

    await expect(
      racyLifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id }),
    ).rejects.toThrow(/changed since it was read/i);

    // The row is NOT left approved, and no spurious approve audit entry was written.
    expect((await ctx.store.getDraft({ ownerUserId: OWNER, draftId: draft.id }))?.status).toBe(
      "draft",
    );
    expect(await ctx.auditActions()).not.toContain("message_draft.approve");
  });
});

describe("approve optimistic-concurrency guard (store seam)", () => {
  // The store applies the `expectedBody` guard atomically in its single UPDATE: the
  // patch lands only if the row's CURRENT body still equals what was read, and a
  // mismatch returns null so the caller distinguishes "body changed" from success.
  it("applies the patch when the body still matches", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const updated = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: draft.id,
      patch: { status: "approved" },
      expectedBody: draft.body,
    });

    expect(updated?.status).toBe("approved");
  });

  it("returns null and writes nothing when the body no longer matches", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const result = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: draft.id,
      patch: { status: "approved" },
      expectedBody: "A body the row never had.",
    });

    expect(result).toBeNull();
    // The row is untouched: still a draft, still the original body.
    const persisted = await ctx.store.getDraft({ ownerUserId: OWNER, draftId: draft.id });
    expect(persisted?.status).toBe("draft");
    expect(persisted?.body).toBe(draft.body);
  });
});

describe("draft editing", () => {
  it("edits the body while preserving the source-reference grounding", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const edited = await ctx.lifecycle.editDraftBody({
      ownerUserId: OWNER,
      draftId: draft.id,
      body: "Totally rewritten by the user.",
    });

    expect(edited.body).toBe("Totally rewritten by the user.");
    // Editing the body never touches the persisted grounding contract.
    expect(edited.sourceRefs).toEqual(draft.sourceRefs);
    expect(await ctx.auditActions()).toContain("message_draft.edit");
  });

  it("rejects an empty or unchanged body", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    await expect(
      ctx.lifecycle.editDraftBody({ ownerUserId: OWNER, draftId: draft.id, body: "   " }),
    ).rejects.toThrow();
    await expect(
      ctx.lifecycle.editDraftBody({ ownerUserId: OWNER, draftId: draft.id, body: draft.body }),
    ).rejects.toThrow();
  });

  it("cannot edit a dismissed draft", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));
    await ctx.lifecycle.dismissDraft({ ownerUserId: OWNER, draftId: draft.id });

    await expect(
      ctx.lifecycle.editDraftBody({ ownerUserId: OWNER, draftId: draft.id, body: "new text" }),
    ).rejects.toThrow();
  });

  it("keeps an edited draft-status draft in draft (no spurious approval)", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    const edited = await ctx.lifecycle.editDraftBody({
      ownerUserId: OWNER,
      draftId: draft.id,
      body: "A revision of an unapproved draft.",
    });

    expect(edited.status).toBe("draft");
  });

  it("revokes approval when an approved draft's body is edited, so the stale approval cannot export the revision", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));
    const approved = await ctx.lifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id });
    expect(approved.status).toBe("approved");

    const edited = await ctx.lifecycle.editDraftBody({
      ownerUserId: OWNER,
      draftId: draft.id,
      // A body the user never read or approved (as a prompt injection would supply).
      body: "Injected replacement the user never approved.",
    });

    // The edit atomically returns the draft to unapproved and records the reversion.
    expect(edited.status).toBe("draft");
    expect(await ctx.auditActions()).toContain("message_draft.edit");

    // End to end: the SHARED Gmail approval gate, reading the current persisted
    // status, now blocks the external write — the prior approval cannot carry the
    // revised body out to Gmail. Re-approval is required first.
    const authorize = createGmailApprovalGate({
      isConnected: async () => true,
      getDraftStatus: async ({ ownerUserId, draftId }) =>
        (await ctx.store.getDraft({ ownerUserId, draftId }))?.status ?? null,
    });
    const gate = await authorize({
      ownerUserId: OWNER,
      messageDraftId: draft.id,
      kind: "create",
      recipient: { email: "casey@example.com", source: "manual_entry", contactMethodId: null },
      subject: "Hi",
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toMatch(/approve/i);
    }

    // Re-approving the reviewed revision restores the ability to export.
    const reapproved = await ctx.lifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id });
    expect(reapproved.status).toBe("approved");
  });
});

describe("atomic approval revocation on body edit (store seam)", () => {
  // The store — not the lifecycle layer — decides the reversion from the row's
  // CURRENT status, in the same UPDATE as the body. These assert that conditional
  // directly, including that only `approved` is touched.
  it("reverts an approved draft to draft in the same update", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person, { status: "approved" }));

    const updated = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: draft.id,
      patch: { body: "A revised body." },
      revertApprovalToDraft: true,
    });

    expect(updated.status).toBe("draft");
    expect(updated.body).toBe("A revised body.");
  });

  it("keeps a draft-status draft in draft", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person, { status: "draft" }));

    const updated = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: draft.id,
      patch: { body: "A revised body." },
      revertApprovalToDraft: true,
    });

    expect(updated.status).toBe("draft");
  });

  it("preserves a dismissed draft's status on a body change", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person, { status: "dismissed" }));

    const updated = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: draft.id,
      patch: { body: "A revised body." },
      revertApprovalToDraft: true,
    });

    expect(updated.status).toBe("dismissed");
  });

  it("preserves a sent_manually draft's status on a body change", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person, { status: "sent_manually" }));

    const updated = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: draft.id,
      patch: { body: "A revised body." },
      revertApprovalToDraft: true,
    });

    expect(updated.status).toBe("sent_manually");
  });

  it("reverts even when the lifecycle's pre-read observed a stale non-approved status (TOCTOU)", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));
    await ctx.lifecycle.approveDraft({ ownerUserId: OWNER, draftId: draft.id });

    // Simulate an approval that commits AFTER editDraftBody's pre-read: getDraft
    // hands back a stale `draft` snapshot while the persisted row is `approved`.
    // If the revert were authorized from that read, the approval would survive.
    const racyStore: InMemoryDraftLifecycleStore = {
      ...ctx.store,
      async getDraft(input) {
        const current = await ctx.store.getDraft(input);
        return current ? { ...current, status: "draft" } : current;
      },
    };
    const racyLifecycle = createDraftLifecycle(racyStore);

    const edited = await racyLifecycle.editDraftBody({
      ownerUserId: OWNER,
      draftId: draft.id,
      body: "A revision written while an approval raced in.",
    });

    // The store reverted from the CURRENT row, not the stale read.
    expect(edited.status).toBe("draft");
    expect((await ctx.store.getDraft({ ownerUserId: OWNER, draftId: draft.id }))?.status).toBe(
      "draft",
    );
  });
});

describe("draft lifecycle owner scoping", () => {
  it("does not let another owner act on a draft", async () => {
    const draft = await ctx.store.createDraft(draftInput(ctx.person));

    await expect(
      ctx.lifecycle.dismissDraft({ ownerUserId: OTHER_OWNER, draftId: draft.id }),
    ).rejects.toThrow();
    await expect(
      ctx.lifecycle.editDraftBody({ ownerUserId: OTHER_OWNER, draftId: draft.id, body: "x" }),
    ).rejects.toThrow();
  });
});
