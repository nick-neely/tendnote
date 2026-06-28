import type { MemoryStatus, Person, Sensitivity, SourceRecordStatus } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createPersonContext } from "../person-context";
import type { DraftAdapter } from "./draft-adapter";
import { createDraftGenerator } from "./generator";
import { createInMemoryDraftStore } from "./in-memory-store";

/**
 * Phase 1G consolidated boundary evals (PRD #75, issue #82). Per-slice tests cover
 * each exclusion individually; these assert the invariants hold together at the
 * persisted-record boundary: only eligible records ever feed a draft, drafting is
 * owner-scoped end to end, and every persisted source reference carries a
 * human-readable label so review/Eve never need a raw id as user-facing copy.
 */

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

const passthroughAdapter: DraftAdapter = async (input) => ({
  body: `Draft for ${input.person.displayName}.`,
  provenance: { generator: "fake" },
});

async function setup() {
  const memoryStore = createInMemoryMemoryStore();
  const draftStore = createInMemoryDraftStore();
  const store = { ...memoryStore, ...draftStore };
  const personContext = createPersonContext(memoryStore);
  const generator = createDraftGenerator(store, personContext, {
    draftAdapter: passthroughAdapter,
  });

  async function makePerson(displayName: string, owner = OWNER): Promise<Person> {
    return memoryStore.createPerson({
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

  async function seedSourceRecord(input: {
    person: Person;
    content: string;
    status?: SourceRecordStatus;
    sensitivity?: Sensitivity;
    link?: boolean;
    owner?: string;
  }) {
    const owner = input.owner ?? OWNER;
    const record = await memoryStore.createSourceRecord({
      ownerUserId: owner,
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
        personId: input.person.id,
        role: "primary",
      });
    }
    return record;
  }

  async function seedMemory(input: {
    person: Person;
    content: string;
    status: MemoryStatus;
    sensitivity?: Sensitivity;
    linkSource?: boolean;
    owner?: string;
  }) {
    const owner = input.owner ?? OWNER;
    const record = await seedSourceRecord({
      person: input.person,
      content: `source for: ${input.content}`,
      sensitivity: input.sensitivity,
      link: input.linkSource,
      owner,
    });
    return memoryStore.createMemory({
      personId: input.person.id,
      ownerUserId: owner,
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

  return { store, draftStore, generator, makePerson, seedSourceRecord, seedMemory };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("Phase 1G boundary — only eligible records feed the persisted draft", () => {
  it("excludes restricted, dismissed, archived, pending, and unlinked records together", async () => {
    const person = await ctx.makePerson("Mark");
    // Ineligible across every excluded category, all at once.
    await ctx.seedMemory({ person, content: "Dismissed", status: "dismissed", linkSource: false });
    await ctx.seedMemory({ person, content: "Archived", status: "archived", linkSource: false });
    await ctx.seedMemory({
      person,
      content: "Restricted divorce details",
      status: "approved",
      sensitivity: "restricted",
      linkSource: false,
    });
    await ctx.seedSourceRecord({ person, content: "Pending note", status: "pending_resolution" });
    await ctx.seedSourceRecord({ person, content: "Unlinked note", link: false });
    // One eligible confirmed fact.
    const eligible = await ctx.seedMemory({
      person,
      content: "Moved to Denver",
      status: "approved",
      linkSource: false,
    });

    const outcome = await ctx.generator.generateDraft({ ownerUserId: OWNER, personId: person.id });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;

    // Read the PERSISTED record: only the eligible fact grounds the draft.
    const stored = await ctx.draftStore.getDraft({ ownerUserId: OWNER, draftId: outcome.draft.id });
    expect(stored?.sourceRefs.map((ref) => ref.id)).toEqual([eligible.id]);
    // No reference carries a restricted/ineligible trust by accident.
    expect(stored?.sourceRefs.every((ref) => ref.trust === "confirmed_fact")).toBe(true);
  });

  it("does not draft to a personless/unresolved target", async () => {
    const outcome = await ctx.generator.generateDraft({
      ownerUserId: OWNER,
      personId: "does-not-exist",
    });
    expect(outcome).toEqual({ status: "skipped", reason: "person_not_found" });
  });
});

describe("Phase 1G boundary — owner scoping and raw-id-free grounding", () => {
  it("never grounds a draft in another owner's person", async () => {
    const theirs = await ctx.makePerson("Other", OTHER_OWNER);
    await ctx.seedMemory({
      person: theirs,
      content: "Their fact",
      status: "approved",
      owner: OTHER_OWNER,
      linkSource: false,
    });

    // The signed-in owner cannot resolve another owner's person.
    const outcome = await ctx.generator.generateDraft({ ownerUserId: OWNER, personId: theirs.id });
    expect(outcome).toEqual({ status: "skipped", reason: "person_not_found" });
  });

  it("persists a human-readable label on every source reference", async () => {
    const person = await ctx.makePerson("Mark");
    await ctx.seedMemory({
      person,
      content: "Moved to Denver",
      status: "approved",
      linkSource: false,
    });

    const outcome = await ctx.generator.generateDraft({
      ownerUserId: OWNER,
      personId: person.id,
      followupContext: { id: "fu-1", reason: "check in after the move" },
    });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    // Review UI and Eve render labels, never raw ids (ADR-0028 foundation).
    expect(outcome.draft.sourceRefs.length).toBeGreaterThan(0);
    expect(outcome.draft.sourceRefs.every((ref) => ref.label.trim().length > 0)).toBe(true);
  });
});
