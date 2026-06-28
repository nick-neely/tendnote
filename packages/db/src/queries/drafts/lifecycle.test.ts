import type { CreateMessageDraftInput, Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
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
