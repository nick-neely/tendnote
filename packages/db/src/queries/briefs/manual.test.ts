import type { Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRelationshipAgendaStore } from "../relationship-agenda/in-memory-store";
import { createRelationshipAgenda } from "../relationship-agenda/query";
import { createBriefGenerator } from "./generator";
import { createInMemoryBriefLifecycleStore } from "./in-memory-store";
import { createBriefLifecycle } from "./lifecycle";
import { createManualBriefGeneration } from "./manual";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";
const LOCAL_DATE = "2026-06-27";

async function setup() {
  const agendaStore = createInMemoryRelationshipAgendaStore();
  const agenda = createRelationshipAgenda(agendaStore);
  const briefStore = createInMemoryBriefLifecycleStore();
  const manual = createManualBriefGeneration(briefStore, agenda);
  const lifecycle = createBriefLifecycle(briefStore);

  async function person(displayName: string, ownerUserId = OWNER) {
    return agendaStore.createPerson({
      ownerUserId,
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

  async function dueFollowup(p: Person, reason: string, ownerUserId = OWNER) {
    return agendaStore.createFollowup({
      ownerUserId,
      personId: p.id,
      reason,
      dueAt: new Date("2026-06-27T09:00:00Z"),
      status: "open",
    });
  }

  const auditActions = async () =>
    (await briefStore.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { agendaStore, briefStore, agenda, manual, lifecycle, person, dueFollowup, auditActions };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("manual brief generation", () => {
  it("manually generates the current daily brief with the manual generation reason", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const result = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(result.outcome).toBe("created");
    expect(result.brief.cadence).toBe("daily");
    expect(result.brief.generationReason).toBe("manual");
    expect(result.brief.items).toHaveLength(1);
  });

  it("manually generates the weekly review through the same seam", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const result = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "weekly",
      localDate: LOCAL_DATE,
    });

    expect(result.outcome).toBe("created");
    expect(result.brief.cadence).toBe("weekly");
    expect(result.brief.generationReason).toBe("manual");
  });

  it("returns the existing current brief by default instead of replacing it", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
    const second = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(second.outcome).toBe("returned_existing");
    expect(second.brief.id).toBe(first.brief.id);
  });

  it("supersedes the current brief on explicit regeneration", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
    const regenerated = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
    });

    expect(regenerated.outcome).toBe("regenerated");
    expect(regenerated.brief.id).not.toBe(first.brief.id);
    expect(regenerated.brief.generationReason).toBe("regenerated");

    const history = await ctx.briefStore.listBriefsForOwner({
      ownerUserId: OWNER,
      includeSuperseded: true,
    });
    expect(history).toHaveLength(2);
  });

  it("respects dismissed feedback when regenerating", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.brief.items[0]?.id ?? "",
    });

    const regenerated = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
    });

    expect(regenerated.brief.items).toHaveLength(0);
  });

  it("respects a live snooze when regenerating", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
    await ctx.lifecycle.snoozeBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.brief.items[0]?.id ?? "",
      snoozedUntil: new Date("2026-06-30T00:00:00Z"),
    });

    const regenerated = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
      now: new Date("2026-06-28T00:00:00Z"),
    });

    expect(regenerated.brief.items).toHaveLength(0);
  });

  it("treats a first-time regenerate request as a create, not a regeneration", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const result = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
    });

    expect(result.outcome).toBe("created");
    expect(result.brief.generationReason).toBe("manual");
    await expect(ctx.auditActions()).resolves.toEqual(["brief.generate"]);
  });

  it("audits manual generation and regeneration", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
    await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
    });

    await expect(ctx.auditActions()).resolves.toEqual(
      expect.arrayContaining(["brief.generate", "brief.regenerate"]),
    );
  });

  it("scopes generation to the requesting owner", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Owner-1 follow-up.");

    const otherResult = await ctx.manual.generateCurrentBrief({
      ownerUserId: OTHER_OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(otherResult.brief.ownerUserId).toBe(OTHER_OWNER);
    expect(otherResult.brief.items).toHaveLength(0);
  });

  it("produces the same brief items as a direct shared-generator call", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const manualResult = await ctx.manual.generateCurrentBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    // A second owner with identical data, generated through the bare generator,
    // yields the same item shape — manual and scheduled share generator behavior.
    const other = await ctx.person("Mark", OTHER_OWNER);
    await ctx.dueFollowup(other, "Reconnect.", OTHER_OWNER);
    const generator = createBriefGenerator(ctx.briefStore, ctx.agenda);
    const direct = await generator.generateBrief({
      ownerUserId: OTHER_OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
    });

    expect(manualResult.brief.items.map((item) => item.title)).toEqual(
      direct.items.map((item) => item.title),
    );
  });
});
