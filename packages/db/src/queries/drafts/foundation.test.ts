import type { CreateMessageDraftInput, DraftSourceRef, Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryDraftLifecycleStore } from "./in-memory-store";
import type { InMemoryDraftLifecycleStore } from "./types";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

const APPROVED_MEMORY_REF: DraftSourceRef = {
  kind: "approved_memory",
  id: "memory-1",
  label: "Just moved to Denver",
  trust: "confirmed_fact",
};

const SUGGESTED_MEMORY_REF: DraftSourceRef = {
  kind: "suggested_memory",
  id: "memory-2",
  label: "Might be training for a marathon",
  trust: "tentative",
};

function draftInput(
  person: Person,
  overrides: Partial<CreateMessageDraftInput> = {},
): CreateMessageDraftInput {
  return {
    ownerUserId: OWNER,
    personId: person.id,
    channel: "text",
    purpose: "check_in",
    body: "Hey — heard you just moved to Denver, how's the new place treating you?",
    status: "draft",
    sourceRefs: [APPROVED_MEMORY_REF],
    ...overrides,
  };
}

async function setup() {
  const store: InMemoryDraftLifecycleStore = createInMemoryDraftLifecycleStore();

  async function makePerson(displayName: string, owner = OWNER): Promise<Person> {
    return store.createPerson({
      ownerUserId: owner,
      displayName,
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  return { store, makePerson };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("draft source-reference foundation", () => {
  it("persists a draft with source references and reads them back stably", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createDraft(
      draftInput(person, {
        sourceRefs: [
          APPROVED_MEMORY_REF,
          {
            kind: "source_record",
            id: "sr-1",
            label: "Talked about the move",
            trust: "logged_context",
          },
          SUGGESTED_MEMORY_REF,
          { kind: "followup", id: "fu-1", label: "Check in after the move", trust: "intent" },
          {
            kind: "brief_item",
            id: "bi-1",
            label: "Surfaced in today's brief",
            trust: "entry_point",
          },
        ],
      }),
    );

    const read = await ctx.store.getDraft({ ownerUserId: OWNER, draftId: created.id });

    expect(read).not.toBeNull();
    expect(read?.sourceRefs).toHaveLength(5);
    expect(read?.sourceRefs.map((ref) => ref.kind)).toEqual([
      "approved_memory",
      "source_record",
      "suggested_memory",
      "followup",
      "brief_item",
    ]);
    // Every persisted reference carries a human-readable label so review/Eve never
    // surface raw ids as user-facing copy.
    expect(read?.sourceRefs.every((ref) => ref.label.length > 0)).toBe(true);
  });

  it("defaults source references to an empty array when none are supplied", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createDraft(draftInput(person, { sourceRefs: [] }));

    expect(created.sourceRefs).toEqual([]);
  });

  it("keeps source references stable as a snapshot after creation", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createDraft(draftInput(person));

    // Editing the body must preserve the grounding contract.
    const edited = await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: created.id,
      patch: { body: "Totally rewritten body that the user typed." },
    });

    expect(edited.body).toContain("Totally rewritten");
    expect(edited.sourceRefs).toEqual(created.sourceRefs);
  });

  it("rejects an unsupported source-reference kind", async () => {
    const person = await ctx.makePerson("Mark");

    await expect(
      ctx.store.createDraft(
        draftInput(person, {
          // biome-ignore lint/suspicious/noExplicitAny: exercising invalid input
          sourceRefs: [
            { kind: "gmail_thread", id: "x", label: "nope", trust: "confirmed_fact" } as any,
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a source reference whose trust tier contradicts its kind", async () => {
    const person = await ctx.makePerson("Mark");

    await expect(
      ctx.store.createDraft(
        draftInput(person, {
          // An approved memory is always a confirmed fact; tentative is invalid.
          sourceRefs: [
            {
              kind: "approved_memory",
              id: "memory-1",
              label: "Moved to Denver",
              trust: "tentative",
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a source reference missing a user-facing label", async () => {
    const person = await ctx.makePerson("Mark");

    await expect(
      ctx.store.createDraft(
        draftInput(person, {
          sourceRefs: [
            { kind: "approved_memory", id: "memory-1", label: "", trust: "confirmed_fact" },
          ],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("draft owner scoping", () => {
  it("does not read another owner's draft", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createDraft(draftInput(person));

    expect(await ctx.store.getDraft({ ownerUserId: OTHER_OWNER, draftId: created.id })).toBeNull();
  });

  it("does not update another owner's draft", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createDraft(draftInput(person));

    await expect(
      ctx.store.updateDraft({
        ownerUserId: OTHER_OWNER,
        draftId: created.id,
        patch: { status: "dismissed" },
      }),
    ).rejects.toThrow();
  });

  it("scopes person and owner draft listings to the owner", async () => {
    const mine = await ctx.makePerson("Mark");
    const theirs = await ctx.makePerson("Other", OTHER_OWNER);
    await ctx.store.createDraft(draftInput(mine));
    await ctx.store.createDraft({
      ownerUserId: OTHER_OWNER,
      personId: theirs.id,
      channel: "text",
      purpose: "other",
      body: "Their private draft.",
      status: "draft",
      sourceRefs: [],
    });

    expect(await ctx.store.listDraftsForOwner({ ownerUserId: OWNER })).toHaveLength(1);
    expect(
      await ctx.store.listDraftsForPerson({ ownerUserId: OWNER, personId: mine.id }),
    ).toHaveLength(1);
    // The owner cannot reach the other owner's person drafts even with the id.
    expect(
      await ctx.store.listDraftsForPerson({ ownerUserId: OWNER, personId: theirs.id }),
    ).toHaveLength(0);
  });

  it("filters listings by status", async () => {
    const person = await ctx.makePerson("Mark");
    const a = await ctx.store.createDraft(draftInput(person));
    await ctx.store.createDraft(draftInput(person));
    await ctx.store.updateDraft({
      ownerUserId: OWNER,
      draftId: a.id,
      patch: { status: "approved" },
    });

    const approved = await ctx.store.listDraftsForPerson({
      ownerUserId: OWNER,
      personId: person.id,
      statuses: ["approved"],
    });

    expect(approved).toHaveLength(1);
    expect(approved[0]?.id).toBe(a.id);
  });
});
