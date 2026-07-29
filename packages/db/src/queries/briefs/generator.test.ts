import type { Memory, Person, SourceRecord } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRelationshipAgendaStore } from "../relationship-agenda/in-memory-store";
import { createRelationshipAgenda } from "../relationship-agenda/query";
import { createBriefGenerator } from "./generator";
import { createInMemoryBriefStore } from "./in-memory-store";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";
const LOCAL_DATE = "2026-06-27";

async function setup() {
  const agendaStore = createInMemoryRelationshipAgendaStore();
  const agenda = createRelationshipAgenda(agendaStore);
  const briefStore = createInMemoryBriefStore();
  const generator = createBriefGenerator(briefStore, agenda);

  async function person(displayName: string, birthday: string | null, ownerUserId = OWNER) {
    return agendaStore.createPerson({
      ownerUserId,
      displayName,
      firstName: null,
      lastName: null,
      birthday,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  async function dueFollowup(p: Person, reason: string, dueAt = new Date("2026-06-27T09:00:00Z")) {
    return agendaStore.createFollowup({
      ownerUserId: OWNER,
      personId: p.id,
      reason,
      dueAt,
      status: "open",
    });
  }

  async function sourceRecord(sensitivity: SourceRecord["sensitivity"], content: string) {
    return agendaStore.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content,
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity,
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
  }

  function seedSuggestedMemory(input: {
    person: Person;
    record: SourceRecord;
    sensitivity: Memory["sensitivity"];
    content: string;
  }) {
    const now = new Date("2026-06-20T00:00:00Z");
    const memory: Memory = {
      id: `memory-${input.person.id}-${input.sensitivity}`,
      ownerUserId: OWNER,
      personId: input.person.id,
      sourceRecordId: input.record.id,
      content: input.content,
      memoryType: "context",
      status: "suggested",
      importance: 3,
      sensitivity: input.sensitivity,
      confidence: "medium",
      scope: "private",
      approvedAt: null,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    agendaStore.seedSuggestedMemories([memory]);
    return memory;
  }

  return {
    agendaStore,
    briefStore,
    generator,
    person,
    dueFollowup,
    sourceRecord,
    seedSuggestedMemory,
  };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("brief generator — daily", () => {
  it("creates a current daily brief snapshotting source-backed agenda candidates", async () => {
    const mark = await ctx.person("Mark", null);
    await ctx.dueFollowup(mark, "Reconnect about the move.");

    const brief = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(brief.cadence).toBe("daily");
    expect(brief.generationReason).toBe("scheduled");
    expect(brief.windowStart.toISOString()).toBe("2026-06-27T00:00:00.000Z");
    expect(brief.windowEnd.toISOString()).toBe("2026-06-28T00:00:00.000Z");
    expect(brief.items).toHaveLength(1);

    const [item] = brief.items;
    expect(item?.kind).toBe("due_followup");
    expect(item?.personDisplayName).toBe("Mark");
    expect(item?.title).toBe("Reconnect about the move.");
    expect(item?.reason).toBe("Reconnect about the move.");
    expect(item?.sourceRefs?.[0]?.kind).toBe("followup");
    expect(item?.rank).toBe(1);
    expect(item?.status).toBe("active");
  });

  it("caps the daily brief at three items", async () => {
    for (let i = 0; i < 5; i += 1) {
      const p = await ctx.person(`Person ${i}`, null);
      await ctx.dueFollowup(p, `Follow up ${i}`, new Date(`2026-06-27T0${i}:00:00Z`));
    }

    const brief = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(brief.items).toHaveLength(3);
    expect(brief.items.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("generates without any embedding/semantic dependency", async () => {
    ctx.agendaStore.failSemanticSearch();
    const mark = await ctx.person("Mark", null);
    await ctx.dueFollowup(mark, "Reconnect.");

    const brief = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(brief.items).toHaveLength(1);
  });
});

describe("brief generator — weekly", () => {
  it("uses the same model with a broader window and broader candidate kinds", async () => {
    const mark = await ctx.person("Mark", null);
    const record = await ctx.sourceRecord("normal", "Mark mentioned a new job.");
    ctx.agendaStore.seedRecentSourceRecords([
      { sourceRecord: record, linkedPeople: [{ id: mark.id, displayName: mark.displayName }] },
    ]);

    const weekly = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "weekly",
      localDate: LOCAL_DATE,
    });
    expect(weekly.windowEnd.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(weekly.items.some((item) => item.kind === "recent_context")).toBe(true);

    // The daily brief does not consider recent context, so weekly is broader.
    const daily = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
    expect(daily.items.some((item) => item.kind === "recent_context")).toBe(false);
  });
});

describe("brief generator — policy", () => {
  it("excludes restricted content from the brief", async () => {
    const mark = await ctx.person("Mark", null);
    await ctx.dueFollowup(mark, "Reconnect.");
    const record = await ctx.sourceRecord("restricted", "Delicate restricted detail.");
    ctx.seedSuggestedMemory({
      person: mark,
      record,
      sensitivity: "restricted",
      content: "Restricted memory that must not surface.",
    });

    const brief = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(brief.items.every((item) => item.sensitivity !== "restricted")).toBe(true);
    expect(brief.items.every((item) => item.kind !== "review_item")).toBe(true);
  });

  it("preserves sensitive content with sensitivity metadata and source references", async () => {
    const mark = await ctx.person("Mark", null);
    const record = await ctx.sourceRecord("sensitive", "Sensitive but groundable context.");
    ctx.seedSuggestedMemory({
      person: mark,
      record,
      sensitivity: "sensitive",
      content: "Sensitive memory worth a careful mention.",
    });

    const brief = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    const sensitiveItem = brief.items.find((item) => item.sensitivity === "sensitive");
    expect(sensitiveItem).toBeDefined();
    expect(sensitiveItem?.sourceRefs.length).toBeGreaterThan(0);
  });
});

describe("brief generator — idempotency", () => {
  it("returns the existing current brief on a duplicate scheduled run", async () => {
    const mark = await ctx.person("Mark", null);
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    // Underlying agenda changes after generation must not alter the persisted brief.
    const other = await ctx.person("Nadia", null);
    await ctx.dueFollowup(other, "New follow-up after generation.");

    const second = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(second.id).toBe(first.id);
    expect(second.items).toHaveLength(1);
  });

  it("supersedes and replaces the brief on explicit regeneration", async () => {
    const mark = await ctx.person("Mark", null);
    await ctx.dueFollowup(mark, "Reconnect.");
    const first = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    const regenerated = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
    });

    expect(regenerated.id).not.toBe(first.id);
    expect(regenerated.generationReason).toBe("regenerated");

    const current = await ctx.briefStore.findCurrentBrief({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      cadence: "daily",
    });
    expect(current?.id).toBe(regenerated.id);

    const history = await ctx.briefStore.listBriefsForOwner({
      ownerUserId: OWNER,
      includeSuperseded: true,
    });
    expect(history).toHaveLength(2);
  });
});

describe("brief generator — owner scoping", () => {
  it("only snapshots the requested owner's agenda candidates", async () => {
    const mark = await ctx.person("Mark", null);
    await ctx.dueFollowup(mark, "Owner-1 follow-up.");

    const otherBrief = await ctx.generator.generateBrief({
      ownerUserId: OTHER_OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(otherBrief.ownerUserId).toBe(OTHER_OWNER);
    expect(otherBrief.items).toHaveLength(0);
  });
});
