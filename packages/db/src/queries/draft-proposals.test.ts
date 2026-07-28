import type { DraftGroundedContext, MemoryStatus, Sensitivity } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAcceptedDraftProposalPersister,
  createDraftProposalGenerator,
} from "./draft-proposals";
import { createInMemoryDraftLifecycleStore } from "./drafts/in-memory-store";
import { createInMemoryMemoryStore } from "./memories/in-memory-store";
import { createPersonContext } from "./person-context";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

function recordingAdapter() {
  const calls: DraftGroundedContext[] = [];
  const adapter = async (input: DraftGroundedContext) => {
    calls.push(input);
    return {
      body: `(${input.toneInstruction}) Hi ${input.person.displayName}, checking in about ${
        input.facts[0] ?? input.loggedContext[0] ?? input.followupReason ?? "today"
      }.`,
      provenance: { generator: "fake" },
    };
  };
  return { adapter, calls };
}

async function setup() {
  const memoryStore = createInMemoryMemoryStore();
  const personContext = createPersonContext(memoryStore);
  const person = await memoryStore.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark Lee",
    firstName: "Mark",
    lastName: "Lee",
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  async function seedSourceRecord(input: {
    content: string;
    ownerUserId?: string;
    status?: "active" | "dismissed" | "archived" | "pending_resolution";
    sensitivity?: Sensitivity;
    link?: boolean;
  }) {
    const record = await memoryStore.createSourceRecord({
      ownerUserId: input.ownerUserId ?? OWNER,
      sourceType: "manual",
      content: input.content,
      rawContent: null,
      retentionPolicy: "retain",
      status: input.status ?? "active",
      confidence: "medium",
      sensitivity: input.sensitivity ?? "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });

    if (input.link !== false && input.ownerUserId !== OTHER_OWNER) {
      await memoryStore.linkSourceRecordPerson({
        sourceRecordId: record.id,
        personId: person.id,
        role: "primary",
      });
    }

    return record;
  }

  async function seedMemory(input: {
    content: string;
    status: MemoryStatus;
    sensitivity?: Sensitivity;
    linkSource?: boolean;
  }) {
    const record = await seedSourceRecord({
      content: `source for: ${input.content}`,
      sensitivity: input.sensitivity,
      link: input.linkSource,
    });

    return memoryStore.createMemory({
      personId: person.id,
      ownerUserId: OWNER,
      sourceRecordId: record.id,
      memoryType: "context",
      content: input.content,
      status: input.status,
      importance: 3,
      sensitivity: input.sensitivity ?? "normal",
      confidence: "medium",
      scope: "private",
      approvedAt: input.status === "approved" ? new Date() : null,
    });
  }

  return { memoryStore, personContext, person, seedSourceRecord, seedMemory };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("draft proposal generation", () => {
  it("returns ephemeral source-grounded tone variants without persisting a message draft", async () => {
    const approved = await ctx.seedMemory({
      content: "Just moved to Denver",
      status: "approved",
      linkSource: false,
    });
    const source = await ctx.seedSourceRecord({ content: "Talked about the new job" });
    const { adapter, calls } = recordingAdapter();
    const generator = createDraftProposalGenerator(ctx.personContext, { draftAdapter: adapter });

    const result = await generator.proposeDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      purpose: "check_in",
      toneVariants: ["warm", "concise"],
    });

    expect(result.proposal).toMatchObject({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      personDisplayName: "Mark Lee",
      purpose: "check_in",
      ephemeral: true,
      persistenceRequiresExplicitOwnerIntent: true,
    });
    expect(result.proposal?.variants).toHaveLength(2);
    expect(result.proposal?.variants.map((variant) => variant.toneInstruction)).toEqual([
      "warm",
      "concise",
    ]);
    expect(result.proposal?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: approved.id, kind: "approved_memory" }),
        expect.objectContaining({ id: source.id, kind: "source_record" }),
      ]),
    );
    expect(calls.map((call) => call.toneInstruction)).toEqual(["warm", "concise"]);
    expect(await ctx.memoryStore.listAuditLogEntries({ ownerUserId: OWNER })).toEqual([]);
  });

  it("skips instead of proposing from thin or wrong-owner context", async () => {
    const { adapter } = recordingAdapter();
    const generator = createDraftProposalGenerator(ctx.personContext, { draftAdapter: adapter });

    const wrongOwner = await generator.proposeDraft({
      ownerUserId: OTHER_OWNER,
      personId: ctx.person.id,
    });

    expect(wrongOwner.proposal).toBeNull();
    expect(wrongOwner.skippedReason).toBe("person_not_found");

    const thin = await generator.proposeDraft({ ownerUserId: OWNER, personId: ctx.person.id });
    expect(thin.proposal).toBeNull();
    expect(thin.skippedReason).toBe("insufficient_context");
  });

  it("blocks restricted context unless the owner directly requested it", async () => {
    await ctx.seedMemory({
      content: "Going through a sensitive family situation",
      status: "approved",
      sensitivity: "restricted",
      linkSource: false,
    });
    const { adapter } = recordingAdapter();
    const generator = createDraftProposalGenerator(ctx.personContext, { draftAdapter: adapter });

    const proactive = await generator.proposeDraft({ ownerUserId: OWNER, personId: ctx.person.id });
    expect(proactive.skippedReason).toBe("insufficient_context");

    const direct = await generator.proposeDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      directlyRequested: true,
    });
    expect(direct.proposal?.sourceRefs[0]).toMatchObject({
      kind: "approved_memory",
      trust: "confirmed_fact",
    });
  });

  it("grounds revision proposals in the existing draft text", async () => {
    await ctx.seedMemory({
      content: "Just moved to Denver",
      status: "approved",
      linkSource: false,
    });
    const { adapter, calls } = recordingAdapter();
    const generator = createDraftProposalGenerator(ctx.personContext, { draftAdapter: adapter });

    const result = await generator.proposeDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      toneVariants: ["shorter"],
      revisionContext: {
        body: "Hi Mark, long existing draft.",
        instruction: "Make it shorter.",
      },
    });

    expect(result.proposal?.variants[0]?.toneInstruction).toBe("shorter");
    expect(calls[0]?.toneInstruction).toContain("Make it shorter.");
    expect(calls[0]?.toneInstruction).toContain("Hi Mark, long existing draft.");
  });

  it("persists the accepted proposal variant body only after explicit owner intent", async () => {
    const store = createInMemoryDraftLifecycleStore();
    const person = await store.createPerson({
      ownerUserId: OWNER,
      displayName: "Maya",
      firstName: "Maya",
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const persister = createAcceptedDraftProposalPersister(store);

    const result = await persister.persistAcceptedDraftProposal({
      ownerUserId: OWNER,
      personId: person.id,
      channel: "text",
      purpose: "check_in",
      body: "Exact accepted proposal body.",
      sourceRefs: [
        {
          kind: "approved_memory",
          id: "memory-1",
          label: "Maya moved to Denver.",
          trust: "confirmed_fact",
        },
      ],
    });

    expect(result.result.status).toBe("created");
    if (result.result.status !== "created") throw new Error("Expected a persisted draft.");
    expect(result.result.draft.body).toBe("Exact accepted proposal body.");
    expect(result.result.draft.sourceRefs[0]).toMatchObject({ id: "memory-1" });
    expect(await store.listDraftsForOwner({ ownerUserId: OWNER })).toHaveLength(1);
    expect(
      (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action),
    ).toContain("message_draft.accepted_proposal");
  });

  it("refuses accepted proposal persistence for another owner's person", async () => {
    const store = createInMemoryDraftLifecycleStore();
    const otherPerson = await store.createPerson({
      ownerUserId: OTHER_OWNER,
      displayName: "Other Owner Person",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const persister = createAcceptedDraftProposalPersister(store);

    await expect(
      persister.persistAcceptedDraftProposal({
        ownerUserId: OWNER,
        personId: otherPerson.id,
        body: "Should not persist.",
        sourceRefs: [
          {
            kind: "approved_memory",
            id: "memory-1",
            label: "Private fact.",
            trust: "confirmed_fact",
          },
        ],
      }),
    ).rejects.toThrow(/unknown person/i);

    expect(await store.listDraftsForOwner({ ownerUserId: OWNER })).toEqual([]);
  });
});
