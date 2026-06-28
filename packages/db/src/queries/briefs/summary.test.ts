import type { BriefSummaryInput, Person } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryRelationshipAgendaStore } from "../relationship-agenda/in-memory-store";
import { createRelationshipAgenda } from "../relationship-agenda/query";
import { createBriefGenerator } from "./generator";
import { createInMemoryBriefStore } from "./in-memory-store";
import type { BriefSummaryAdapter } from "./summary-adapter";

const OWNER = "user-1";
const LOCAL_DATE = "2026-06-27";

async function setup(summaryAdapter?: BriefSummaryAdapter) {
  const agendaStore = createInMemoryRelationshipAgendaStore();
  const agenda = createRelationshipAgenda(agendaStore);
  const briefStore = createInMemoryBriefStore();
  const generator = createBriefGenerator(briefStore, agenda, { summaryAdapter });

  async function person(displayName: string): Promise<Person> {
    return agendaStore.createPerson({
      ownerUserId: OWNER,
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

  async function seedFollowup() {
    const mark = await person("Mark");
    await agendaStore.createFollowup({
      ownerUserId: OWNER,
      personId: mark.id,
      reason: "Reconnect.",
      dueAt: new Date("2026-06-27T09:00:00Z"),
      status: "open",
    });
  }

  function generate() {
    return generator.generateBrief({ ownerUserId: OWNER, cadence: "daily", localDate: LOCAL_DATE });
  }

  return { agendaStore, briefStore, generator, seedFollowup, generate };
}

describe("brief summary decoration", () => {
  it("stores the summary line and provenance on success", async () => {
    const ctx = await setup(async () => ({
      summary: "One person to keep in mind today: Mark.",
      provenance: { generator: "fake", version: "test:1" },
    }));
    await ctx.seedFollowup();

    const brief = await ctx.generate();
    expect(brief.summary).toBe("One person to keep in mind today: Mark.");
    expect(brief.summaryProvenance).toEqual({ generator: "fake", version: "test:1" });
  });

  it("stores no summary when there is no adapter", async () => {
    const ctx = await setup();
    await ctx.seedFollowup();

    const brief = await ctx.generate();
    expect(brief.summary).toBeNull();
    expect(brief.summaryProvenance).toBeNull();
  });

  it("stores no summary when the adapter returns null or empty text", async () => {
    const nullCtx = await setup(async () => null);
    await nullCtx.seedFollowup();
    expect((await nullCtx.generate()).summary).toBeNull();

    const emptyCtx = await setup(async () => ({ summary: "   ", provenance: {} }));
    await emptyCtx.seedFollowup();
    expect((await emptyCtx.generate()).summary).toBeNull();
  });

  it("fails open: an adapter that throws does not block brief creation", async () => {
    const ctx = await setup(async () => {
      throw new Error("summary model unavailable");
    });
    await ctx.seedFollowup();

    const brief = await ctx.generate();
    expect(brief.summary).toBeNull();
    expect(brief.summaryProvenance).toBeNull();
    // The deterministic items are unaffected by summary failure.
    expect(brief.items).toHaveLength(1);
    expect(brief.items[0]?.kind).toBe("due_followup");
  });

  it("passes only presentation fields (no source ids) to the adapter", async () => {
    let received: BriefSummaryInput | null = null;
    const ctx = await setup(async (input) => {
      received = input;
      return { summary: "ok", provenance: {} };
    });
    await ctx.seedFollowup();
    await ctx.generate();

    expect(received).not.toBeNull();
    const summaryInput = received as unknown as BriefSummaryInput;
    expect(summaryInput.cadence).toBe("daily");
    const keys = Object.keys(summaryInput.items[0] ?? {});
    expect(keys.sort()).toEqual(["kind", "personDisplayName", "reason", "title"]);
  });

  it("does not change item selection, rank, or source refs", async () => {
    const ctx = await setup(async () => ({ summary: "decorated", provenance: {} }));
    await ctx.seedFollowup();
    const decorated = await ctx.generate();

    // The decorated brief carries the same deterministic item shape it would have
    // without a summary: one due-follow-up at rank 1 grounded in a follow-up ref.
    expect(decorated.items).toHaveLength(1);
    expect(decorated.items[0]?.kind).toBe("due_followup");
    expect(decorated.items[0]?.rank).toBe(1);
    expect(decorated.items[0]?.sourceRefs.map((ref) => ref.kind)).toEqual(["followup"]);
    expect(decorated.summary).toBe("decorated");
  });
});
