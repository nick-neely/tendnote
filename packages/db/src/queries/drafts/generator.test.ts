import type { DraftGroundedContext, MemoryStatus, Sensitivity } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createPersonContext } from "../person-context";
import type { DraftAdapter } from "./draft-adapter";
import { createDraftGenerator } from "./generator";
import { createInMemoryDraftStore } from "./in-memory-store";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

// A fake adapter that echoes the grounded context it received, so tests can assert
// what grounding the generator passed to the model without a live call.
function recordingAdapter() {
  const calls: DraftGroundedContext[] = [];
  const adapter: DraftAdapter = async (input) => {
    calls.push(input);
    return { body: `Draft for ${input.person.displayName}`, provenance: { generator: "fake" } };
  };
  return { adapter, calls };
}

async function setup() {
  const memoryStore = createInMemoryMemoryStore();
  const draftStore = createInMemoryDraftStore();
  // The composed store satisfies DraftLifecycleStore: draft persistence + the
  // person/source/audit surface from the memory (source-record) base.
  const store = { ...memoryStore, ...draftStore };
  const personContext = createPersonContext(memoryStore);

  const person = await memoryStore.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark Lee",
    firstName: "Mark",
    lastName: "Lee",
    birthday: "1990-04-12",
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  async function seedSourceRecord(input: {
    content: string;
    status?: "active" | "dismissed" | "archived" | "pending_resolution";
    sensitivity?: Sensitivity;
    link?: boolean;
  }) {
    const record = await memoryStore.createSourceRecord({
      ownerUserId: OWNER,
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

    if (input.link !== false) {
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
    // When false, the backing source record is left unlinked so it does not also
    // surface as logged context — isolating the memory itself in assertions.
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

  const auditActions = async () =>
    (await memoryStore.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { store, memoryStore, personContext, person, seedSourceRecord, seedMemory, auditActions };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("draft generation — grounding and trust policy", () => {
  it("creates a grounded draft and persists trust-tiered source references", async () => {
    const approved = await ctx.seedMemory({ content: "Just moved to Denver", status: "approved" });
    const suggested = await ctx.seedMemory({
      content: "Might be training for a marathon",
      status: "suggested",
    });
    const sourceRecord = await ctx.seedSourceRecord({ content: "Talked about the new job" });

    const { adapter, calls } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      purpose: "check_in",
    });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;

    // Grounding passed to the adapter is trust-classified: approved as facts,
    // source records as logged context, suggested only as tentative.
    expect(calls[0]?.facts).toContain("Just moved to Denver");
    expect(calls[0]?.loggedContext).toContain("Talked about the new job");
    expect(calls[0]?.tentative).toContain("Might be training for a marathon");

    const refs = outcome.draft.sourceRefs;
    expect(refs.find((r) => r.id === approved.id)).toMatchObject({
      kind: "approved_memory",
      trust: "confirmed_fact",
    });
    expect(refs.find((r) => r.id === sourceRecord.id)).toMatchObject({
      kind: "source_record",
      trust: "logged_context",
    });
    expect(refs.find((r) => r.id === suggested.id)).toMatchObject({
      kind: "suggested_memory",
      trust: "tentative",
    });
  });

  it("writes an audit entry for the generated draft", async () => {
    await ctx.seedMemory({ content: "Just moved to Denver", status: "approved" });
    const { adapter } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    await generator.generateDraft({ ownerUserId: OWNER, personId: ctx.person.id });

    expect(await ctx.auditActions()).toContain("message_draft.generated");
  });

  it("excludes dismissed, archived, pending, and unlinked records from grounding", async () => {
    // Backing source records are left unlinked so only the memory status is under
    // test, not its source record (which would legitimately be logged context).
    await ctx.seedMemory({ content: "Dismissed hint", status: "dismissed", linkSource: false });
    await ctx.seedMemory({ content: "Archived fact", status: "archived", linkSource: false });
    await ctx.seedSourceRecord({ content: "Pending note", status: "pending_resolution" });
    await ctx.seedSourceRecord({ content: "Unlinked note", link: false });
    // One eligible fact so the draft is still created and we can inspect grounding.
    const approved = await ctx.seedMemory({
      content: "Loves hiking",
      status: "approved",
      linkSource: false,
    });

    const { adapter, calls } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });
    const outcome = await generator.generateDraft({ ownerUserId: OWNER, personId: ctx.person.id });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    // The only grounding ref is the approved fact; excluded records contribute none.
    expect(outcome.draft.sourceRefs.map((r) => r.id)).toEqual([approved.id]);
    expect(calls[0]?.facts).toEqual(["Loves hiking"]);
    expect(calls[0]?.tentative).not.toContain("Dismissed hint");
    expect(calls[0]?.loggedContext).not.toContain("Pending note");
    expect(calls[0]?.loggedContext).not.toContain("Unlinked note");
  });

  it("includes sensitive (non-restricted) content in a draft and grounds it", async () => {
    // Sensitive is distinct from restricted: it is eligible for drafting by default
    // (canUseSensitiveContext blocks only restricted), but stays source-grounded.
    const sensitive = await ctx.seedMemory({
      content: "Recently lost their father",
      status: "approved",
      sensitivity: "sensitive",
      linkSource: false,
    });
    const { adapter, calls } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({ ownerUserId: OWNER, personId: ctx.person.id });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(calls[0]?.facts).toContain("Recently lost their father");
    expect(outcome.draft.sourceRefs.map((r) => r.id)).toEqual([sensitive.id]);
  });

  it("keeps restricted content out of a draft unless directly requested", async () => {
    await ctx.seedMemory({
      content: "Going through a tough divorce",
      status: "approved",
      sensitivity: "restricted",
    });
    const { adapter } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    // Not directly requested: restricted is excluded, leaving no grounding → skip.
    const proactive = await generator.generateDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
    });
    expect(proactive.status).toBe("skipped");
    if (proactive.status === "skipped") {
      expect(proactive.reason).toBe("insufficient_context");
    }

    // Directly requested: restricted content may ground the draft.
    const direct = await generator.generateDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      directlyRequested: true,
    });
    expect(direct.status).toBe("created");
  });
});

describe("draft generation — refusal cases", () => {
  it("skips when the person does not resolve", async () => {
    const { adapter } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({
      ownerUserId: OWNER,
      personId: "does-not-exist",
    });

    expect(outcome).toEqual({ status: "skipped", reason: "person_not_found" });
  });

  it("does not read a person owned by someone else", async () => {
    await ctx.seedMemory({ content: "Just moved", status: "approved" });
    const { adapter } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({
      ownerUserId: OTHER_OWNER,
      personId: ctx.person.id,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "person_not_found" });
  });

  it("skips when only tentative suggested memories exist (not enough grounding)", async () => {
    // Unlinked backing record so the suggested memory is the only context — and a
    // tentative hint alone is not enough grounding to justify a draft.
    await ctx.seedMemory({ content: "Might like jazz", status: "suggested", linkSource: false });
    const { adapter } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({ ownerUserId: OWNER, personId: ctx.person.id });

    expect(outcome).toEqual({ status: "skipped", reason: "insufficient_context" });
  });

  it("creates a draft from an explicit follow-up even without stored memories", async () => {
    const { adapter, calls } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      followupContext: { id: "fu-1", reason: "check in after the move" },
    });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(calls[0]?.followupReason).toBe("check in after the move");
    expect(outcome.draft.sourceRefs).toContainEqual({
      kind: "followup",
      id: "fu-1",
      label: "check in after the move",
      trust: "intent",
    });
  });

  it("records a brief item as grounding when supplied", async () => {
    const { adapter } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({
      ownerUserId: OWNER,
      personId: ctx.person.id,
      briefItemContext: { id: "bi-1", title: "Reconnect with Mark", reason: "It has been a while" },
    });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.draft.sourceRefs).toContainEqual({
      kind: "brief_item",
      id: "bi-1",
      label: "It has been a while",
      trust: "entry_point",
    });
  });

  it("skips without persisting when the adapter throws", async () => {
    await ctx.seedMemory({ content: "Just moved to Denver", status: "approved" });
    const throwingAdapter: DraftAdapter = async () => {
      throw new Error("model outage");
    };
    const generator = createDraftGenerator(ctx.store, ctx.personContext, {
      draftAdapter: throwingAdapter,
    });

    const outcome = await generator.generateDraft({ ownerUserId: OWNER, personId: ctx.person.id });

    expect(outcome).toEqual({ status: "skipped", reason: "generation_failed" });
    expect(await ctx.store.listDraftsForOwner({ ownerUserId: OWNER })).toHaveLength(0);
    expect(await ctx.auditActions()).not.toContain("message_draft.generated");
  });
});

describe("draft generation — no embedding dependency (fail-open)", () => {
  it("drafts purely from exact, policy-filtered context with no semantic retrieval", async () => {
    // Drafting depends only on the trust-aware person context, so it stays useful
    // when embeddings are missing, stale, or skipped (PRD user story #24). There is
    // no semantic seam that could feed ungoverned content past the trust policy.
    await ctx.seedMemory({
      content: "Just moved to Denver",
      status: "approved",
      linkSource: false,
    });
    const { adapter, calls } = recordingAdapter();
    const generator = createDraftGenerator(ctx.store, ctx.personContext, { draftAdapter: adapter });

    const outcome = await generator.generateDraft({ ownerUserId: OWNER, personId: ctx.person.id });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(calls[0]?.facts).toEqual(["Just moved to Denver"]);
    expect(outcome.draft.sourceRefs.map((r) => r.kind)).toEqual(["approved_memory"]);
  });
});
