import type { Memory, Person, SourceRecord } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRelationshipAgendaStore } from "../relationship-agenda/in-memory-store";
import { createRelationshipAgenda } from "../relationship-agenda/query";
import { createBriefGenerator } from "./generator";
import { createInMemoryBriefLifecycleStore } from "./in-memory-store";
import { createManualBriefGeneration } from "./manual";

/**
 * Phase 1F boundary evals (PRD #65, issue #74). These assert invariants at the
 * persistence and cross-path boundaries that the per-slice tests do not: policy is
 * enforced in the persisted record (not just the return value), the manual and
 * scheduled paths converge on the same persisted brief, and the read path returns
 * the stored snapshot rather than recomputing the live agenda. Restricted/sensitive
 * selection itself is unit-tested in generator.test.ts; the no-live-model adapter in
 * default-summary-adapter.test.ts; the no-receive dispatcher in active-eve-tree.
 */

const OWNER = "user-1";
const LOCAL_DATE = "2026-06-27";

async function setup() {
  const agendaStore = createInMemoryRelationshipAgendaStore();
  const agenda = createRelationshipAgenda(agendaStore);
  const briefStore = createInMemoryBriefLifecycleStore();
  const generator = createBriefGenerator(briefStore, agenda);
  const manual = createManualBriefGeneration(briefStore, agenda);

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

  async function dueFollowup(p: Person, reason: string) {
    return agendaStore.createFollowup({
      ownerUserId: OWNER,
      personId: p.id,
      reason,
      dueAt: new Date("2026-06-27T09:00:00Z"),
      status: "open",
    });
  }

  async function sourceRecord(sensitivity: SourceRecord["sensitivity"]) {
    return agendaStore.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Logged context.",
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

  function seedMemories(
    memories: Array<{ person: Person; record: SourceRecord; sensitivity: Memory["sensitivity"] }>,
  ) {
    const now = new Date("2026-06-20T00:00:00Z");
    agendaStore.seedSuggestedMemories(
      memories.map((entry) => ({
        id: `memory-${entry.person.id}-${entry.sensitivity}`,
        ownerUserId: OWNER,
        personId: entry.person.id,
        sourceRecordId: entry.record.id,
        content: "Memory content.",
        memoryType: "context",
        status: "suggested",
        importance: 3,
        sensitivity: entry.sensitivity,
        confidence: "medium",
        scope: "private",
        approvedAt: null,
        dismissedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  function generateScheduled(cadence: "daily" | "weekly" = "daily") {
    return generator.generateBrief({
      ownerUserId: OWNER,
      cadence,
      localDate: LOCAL_DATE,
      generationReason: "scheduled",
    });
  }

  return {
    agendaStore,
    briefStore,
    manual,
    person,
    dueFollowup,
    sourceRecord,
    seedMemories,
    generateScheduled,
  };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("Phase 1F boundary — policy holds in the persisted record", () => {
  it("never persists restricted items and persists sensitive items with grounding", async () => {
    const restrictedPerson = await ctx.person("Restricted");
    const sensitivePerson = await ctx.person("Sensitive");
    const restrictedRecord = await ctx.sourceRecord("restricted");
    const sensitiveRecord = await ctx.sourceRecord("sensitive");
    ctx.seedMemories([
      { person: restrictedPerson, record: restrictedRecord, sensitivity: "restricted" },
      { person: sensitivePerson, record: sensitiveRecord, sensitivity: "sensitive" },
    ]);

    await ctx.generateScheduled("weekly");

    // Read the PERSISTED record, not the generator return value: restricted
    // content must never be snapshotted; sensitive content is kept with metadata.
    const stored = await ctx.briefStore.findCurrentBrief({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      cadence: "weekly",
    });
    expect(stored?.items.every((item) => item.sensitivity !== "restricted")).toBe(true);
    const sensitive = stored?.items.find((item) => item.sensitivity === "sensitive");
    expect(sensitive).toBeDefined();
    expect(sensitive?.sourceRefs.length).toBeGreaterThan(0);
  });
});

describe("Phase 1F boundary — manual and scheduled converge", () => {
  it("returns the scheduled-generated brief from the manual path for the same owner", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const scheduled = await ctx.generateScheduled("daily");

    // The manual seam, built from the same store + generator, finds and returns the
    // exact brief the scheduled path persisted — the two entry points cannot fork.
    const manual = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(manual.outcome).toBe("returned_existing");
    expect(manual.brief.id).toBe(scheduled.id);
  });
});

describe("Phase 1F boundary — render from snapshot", () => {
  it("returns the stored snapshot from findCurrentBrief even after the agenda changes", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const generated = await ctx.generateScheduled("daily");
    expect(generated.items).toHaveLength(1);

    // The underlying agenda changes after generation; the persisted brief read
    // must NOT recompute — it returns the original snapshot.
    const nadia = await ctx.person("Nadia");
    await ctx.dueFollowup(nadia, "New follow-up after generation.");

    const read = await ctx.briefStore.findCurrentBrief({
      ownerUserId: OWNER,
      localDate: LOCAL_DATE,
      cadence: "daily",
    });
    expect(read?.items).toHaveLength(1);
    expect(read?.items[0]?.id).toBe(generated.items[0]?.id);
    expect(read?.items[0]?.title).toBe(generated.items[0]?.title);
  });
});

describe("Phase 1F boundary — private owner-scoped brief reads", () => {
  it("does not expose persisted briefs or brief items to another household member by default", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");
    const generated = await ctx.generateScheduled("daily");
    const firstItem = generated.items[0];

    await expect(
      ctx.briefStore.getBrief({ ownerUserId: "intruder", briefId: generated.id }),
    ).resolves.toBeNull();
    await expect(
      ctx.briefStore.findCurrentBrief({
        ownerUserId: "intruder",
        localDate: LOCAL_DATE,
        cadence: "daily",
      }),
    ).resolves.toBeNull();
    if (firstItem) {
      await expect(
        ctx.briefStore.updateBriefItem({
          ownerUserId: "intruder",
          briefItemId: firstItem.id,
          patch: { status: "dismissed" },
        }),
      ).rejects.toThrow("Brief item not found.");
    }
  });
});
