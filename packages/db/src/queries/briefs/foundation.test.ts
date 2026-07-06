import type { CreateBriefInput, CreateBriefItemInput, Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryBriefLifecycleStore } from "./in-memory-store";
import { createBriefLifecycle } from "./lifecycle";
import type { InMemoryBriefLifecycleStore } from "./types";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

function dailyHeader(overrides: Partial<CreateBriefInput> = {}): Omit<CreateBriefInput, "items"> {
  return {
    ownerUserId: OWNER,
    cadence: "daily",
    localDate: "2026-06-27",
    generationReason: "manual",
    generatedAt: new Date("2026-06-27T08:00:00Z"),
    windowStart: new Date("2026-06-27T00:00:00Z"),
    windowEnd: new Date("2026-06-28T00:00:00Z"),
    summary: null,
    summaryProvenance: null,
    supersededAt: null,
    ...overrides,
  };
}

function followupItem(
  person: Person,
  overrides: Partial<CreateBriefItemInput> = {},
): CreateBriefItemInput {
  return {
    ownerUserId: OWNER,
    kind: "due_followup",
    personId: person.id,
    personDisplayName: person.displayName,
    title: `Follow up with ${person.displayName}`,
    reason: "Reconnect about the move.",
    dueAt: new Date("2026-06-27T09:00:00Z"),
    sourceRefs: [{ kind: "followup", id: "followup-1" }],
    trustLevel: "active_reminder",
    sensitivity: "normal",
    scope: "private",
    householdId: null,
    rank: 1,
    status: "active",
    snoozedUntil: null,
    ...overrides,
  };
}

async function setup() {
  const store: InMemoryBriefLifecycleStore = createInMemoryBriefLifecycleStore();
  const lifecycle = createBriefLifecycle(store);

  async function makePerson(displayName: string): Promise<Person> {
    return store.createPerson({
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

  const auditActions = async () =>
    (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { store, lifecycle, makePerson, auditActions };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("brief artifact foundation", () => {
  it("persists a brief with item snapshots and reads them back stably", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createBrief({
      ...dailyHeader(),
      items: [
        followupItem(person, { rank: 1 }),
        followupItem(person, { rank: 2, title: "Second" }),
      ],
    });

    expect(created.cadence).toBe("daily");
    expect(created.items).toHaveLength(2);

    const fetched = await ctx.store.getBrief({ ownerUserId: OWNER, briefId: created.id });
    expect(fetched?.items.map((item) => item.rank)).toEqual([1, 2]);
    expect(fetched?.items[0]?.title).toBe(`Follow up with ${person.displayName}`);
    expect(fetched?.items[0]?.reason).toBe("Reconnect about the move.");
    expect(fetched?.items[0]?.sourceRefs).toEqual([{ kind: "followup", id: "followup-1" }]);
    expect(fetched?.items[0]?.status).toBe("active");
  });

  it("scopes briefs and items to the owner", async () => {
    const person = await ctx.makePerson("Mark");
    const created = await ctx.store.createBrief({
      ...dailyHeader(),
      items: [followupItem(person)],
    });

    await expect(
      ctx.store.getBrief({ ownerUserId: OTHER_OWNER, briefId: created.id }),
    ).resolves.toBeNull();
    await expect(
      ctx.store.findCurrentBrief({
        ownerUserId: OTHER_OWNER,
        localDate: "2026-06-27",
        cadence: "daily",
      }),
    ).resolves.toBeNull();
    await expect(
      ctx.store.getBriefItem({ ownerUserId: OTHER_OWNER, briefItemId: created.items[0]?.id ?? "" }),
    ).resolves.toBeNull();
  });

  it("enforces one current brief per owner, local date, and cadence", async () => {
    await ctx.store.createBrief({ ...dailyHeader(), items: [] });

    await expect(ctx.store.createBrief({ ...dailyHeader(), items: [] })).rejects.toThrow(
      /current brief already exists/i,
    );
  });

  it("lets daily and weekly briefs coexist for the same owner and local date", async () => {
    await ctx.store.createBrief({ ...dailyHeader(), items: [] });
    await ctx.store.createBrief({ ...dailyHeader({ cadence: "weekly" }), items: [] });

    const daily = await ctx.store.findCurrentBrief({
      ownerUserId: OWNER,
      localDate: "2026-06-27",
      cadence: "daily",
    });
    const weekly = await ctx.store.findCurrentBrief({
      ownerUserId: OWNER,
      localDate: "2026-06-27",
      cadence: "weekly",
    });

    expect(daily?.cadence).toBe("daily");
    expect(weekly?.cadence).toBe("weekly");
  });

  it("supersedes a current brief so a replacement can be created while history persists", async () => {
    const first = await ctx.store.createBrief({ ...dailyHeader(), items: [] });

    const superseded = await ctx.store.supersedeCurrentBrief({
      ownerUserId: OWNER,
      localDate: "2026-06-27",
      cadence: "daily",
      supersededAt: new Date("2026-06-27T10:00:00Z"),
    });
    expect(superseded?.id).toBe(first.id);

    const second = await ctx.store.createBrief({
      ...dailyHeader({ generationReason: "regenerated" }),
      items: [],
    });

    const current = await ctx.store.findCurrentBrief({
      ownerUserId: OWNER,
      localDate: "2026-06-27",
      cadence: "daily",
    });
    expect(current?.id).toBe(second.id);

    const onlyCurrent = await ctx.store.listBriefsForOwner({ ownerUserId: OWNER });
    expect(onlyCurrent.map((brief) => brief.id)).toEqual([second.id]);

    const withHistory = await ctx.store.listBriefsForOwner({
      ownerUserId: OWNER,
      includeSuperseded: true,
    });
    expect(withHistory.map((brief) => brief.id).sort()).toEqual([first.id, second.id].sort());
  });
});

describe("brief item lifecycle", () => {
  it("dismisses, snoozes, and marks items acted-on with audit entries", async () => {
    const person = await ctx.makePerson("Mark");
    const brief = await ctx.store.createBrief({
      ...dailyHeader(),
      items: [
        followupItem(person, { rank: 1 }),
        followupItem(person, { rank: 2 }),
        followupItem(person, { rank: 3 }),
      ],
    });
    const [first, second, third] = brief.items;

    const dismissed = await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: first?.id ?? "",
    });
    expect(dismissed.status).toBe("dismissed");

    const snoozed = await ctx.lifecycle.snoozeBriefItem({
      ownerUserId: OWNER,
      briefItemId: second?.id ?? "",
      snoozedUntil: new Date("2026-07-01T00:00:00Z"),
    });
    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.snoozedUntil?.toISOString()).toBe("2026-07-01T00:00:00.000Z");

    const acted = await ctx.lifecycle.markBriefItemActed({
      ownerUserId: OWNER,
      briefItemId: third?.id ?? "",
    });
    expect(acted.status).toBe("acted_on");

    await expect(ctx.auditActions()).resolves.toEqual(
      expect.arrayContaining(["brief_item.dismiss", "brief_item.snooze", "brief_item.act"]),
    );
  });

  it("rejects invalid item transitions", async () => {
    const person = await ctx.makePerson("Mark");
    const brief = await ctx.store.createBrief({ ...dailyHeader(), items: [followupItem(person)] });
    const item = brief.items[0];

    await ctx.lifecycle.dismissBriefItem({ ownerUserId: OWNER, briefItemId: item?.id ?? "" });
    await expect(
      ctx.lifecycle.snoozeBriefItem({
        ownerUserId: OWNER,
        briefItemId: item?.id ?? "",
        snoozedUntil: new Date("2026-07-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/dismissed/);
  });

  it("refuses to mutate another owner's item", async () => {
    const person = await ctx.makePerson("Mark");
    const brief = await ctx.store.createBrief({ ...dailyHeader(), items: [followupItem(person)] });

    await expect(
      ctx.lifecycle.dismissBriefItem({
        ownerUserId: OTHER_OWNER,
        briefItemId: brief.items[0]?.id ?? "",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("prior brief item querying", () => {
  it("returns cleared items across briefs filtered by status and cadence for feedback suppression", async () => {
    const person = await ctx.makePerson("Mark");
    const brief = await ctx.store.createBrief({
      ...dailyHeader(),
      items: [followupItem(person, { rank: 1 }), followupItem(person, { rank: 2 })],
    });
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: brief.items[0]?.id ?? "",
    });

    const dismissed = await ctx.store.listBriefItemsForOwner({
      ownerUserId: OWNER,
      cadence: "daily",
      statuses: ["dismissed"],
    });
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]?.status).toBe("dismissed");

    const weeklyDismissed = await ctx.store.listBriefItemsForOwner({
      ownerUserId: OWNER,
      cadence: "weekly",
      statuses: ["dismissed"],
    });
    expect(weeklyDismissed).toHaveLength(0);
  });

  it("still returns prior items from a superseded brief alongside the current brief", async () => {
    const person = await ctx.makePerson("Mark");

    // First (soon-to-be-superseded) brief with a dismissed item.
    const first = await ctx.store.createBrief({ ...dailyHeader(), items: [followupItem(person)] });
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.items[0]?.id ?? "",
    });
    await ctx.store.supersedeCurrentBrief({
      ownerUserId: OWNER,
      localDate: "2026-06-27",
      cadence: "daily",
      supersededAt: new Date("2026-06-27T10:00:00Z"),
    });

    // Replacement current brief with an active item for the same person.
    const second = await ctx.store.createBrief({
      ...dailyHeader({ generationReason: "regenerated" }),
      items: [followupItem(person)],
    });

    const allDaily = await ctx.store.listBriefItemsForOwner({
      ownerUserId: OWNER,
      cadence: "daily",
    });
    const briefIds = new Set(allDaily.map((item) => item.briefId));

    // Items from both the superseded and the current brief are queryable, so
    // feedback suppression and audit do not depend on a brief still being current.
    expect(briefIds.has(first.id)).toBe(true);
    expect(briefIds.has(second.id)).toBe(true);
    expect(allDaily.filter((item) => item.status === "dismissed")).toHaveLength(1);
  });
});
