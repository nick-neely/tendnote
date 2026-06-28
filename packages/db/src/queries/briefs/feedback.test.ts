import type { Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRelationshipAgendaStore } from "../relationship-agenda/in-memory-store";
import { createRelationshipAgenda } from "../relationship-agenda/query";
import { createBriefGenerator } from "./generator";
import { createInMemoryBriefLifecycleStore } from "./in-memory-store";
import { createBriefLifecycle } from "./lifecycle";

const OWNER = "user-1";
const LOCAL_DATE = "2026-06-27";
const NEXT_DATE = "2026-06-28";

async function setup() {
  const agendaStore = createInMemoryRelationshipAgendaStore();
  const agenda = createRelationshipAgenda(agendaStore);
  const briefStore = createInMemoryBriefLifecycleStore();
  const generator = createBriefGenerator(briefStore, agenda);
  const lifecycle = createBriefLifecycle(briefStore);

  async function person(displayName: string) {
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

  async function dueFollowup(p: Person, reason: string, dueAt = new Date("2026-06-27T09:00:00Z")) {
    return agendaStore.createFollowup({
      ownerUserId: OWNER,
      personId: p.id,
      reason,
      dueAt,
      status: "open",
    });
  }

  function generate(input: { regenerate?: boolean; localDate?: string; now?: Date } = {}) {
    return generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: input.localDate ?? LOCAL_DATE,
      regenerate: input.regenerate,
      now: input.now,
    });
  }

  return { agendaStore, briefStore, generator, lifecycle, person, dueFollowup, generate };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("brief feedback suppression", () => {
  it("does not reintroduce a dismissed item with the same source, person, and kind", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.generate();
    expect(first.items).toHaveLength(1);
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.items[0]?.id ?? "",
    });

    const regenerated = await ctx.generate({ regenerate: true });
    expect(regenerated.items).toHaveLength(0);
  });

  it("suppresses a snoozed item until the snooze expires, then lets it return", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.generate();
    await ctx.lifecycle.snoozeBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.items[0]?.id ?? "",
      snoozedUntil: new Date("2026-06-29T00:00:00Z"),
    });

    // Still snoozed at regeneration time → suppressed.
    const whileSnoozed = await ctx.generate({
      regenerate: true,
      now: new Date("2026-06-28T00:00:00Z"),
    });
    expect(whileSnoozed.items).toHaveLength(0);

    // After the snooze expires → the candidate can appear again.
    const afterExpiry = await ctx.generate({
      regenerate: true,
      now: new Date("2026-06-30T00:00:00Z"),
    });
    expect(afterExpiry.items).toHaveLength(1);
  });

  it("keeps acted-on items from returning as unresolved prompts", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.generate();
    await ctx.lifecycle.markBriefItemActed({
      ownerUserId: OWNER,
      briefItemId: first.items[0]?.id ?? "",
    });

    const regenerated = await ctx.generate({ regenerate: true });
    expect(regenerated.items).toHaveLength(0);
  });

  it("only suppresses the matching candidate, not unrelated people", async () => {
    const mark = await ctx.person("Mark");
    const nadia = await ctx.person("Nadia");
    await ctx.dueFollowup(mark, "Reconnect with Mark.", new Date("2026-06-27T08:00:00Z"));
    await ctx.dueFollowup(nadia, "Reconnect with Nadia.", new Date("2026-06-27T09:00:00Z"));

    const first = await ctx.generate();
    const markItem = first.items.find((item) => item.personDisplayName === "Mark");
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: markItem?.id ?? "",
    });

    const regenerated = await ctx.generate({ regenerate: true });
    expect(regenerated.items.map((item) => item.personDisplayName)).toEqual(["Nadia"]);
  });

  it("still surfaces a different follow-up for the same person (distinct source ref)", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reason A.", new Date("2026-06-27T08:00:00Z"));
    await ctx.dueFollowup(mark, "Reason B.", new Date("2026-06-27T09:00:00Z"));

    const first = await ctx.generate();
    expect(first.items).toHaveLength(2);
    const itemA = first.items.find((item) => item.reason === "Reason A.");
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: itemA?.id ?? "",
    });

    // Same person and kind, but a different follow-up (source ref) — the spec's
    // conjunction means this is a genuinely new prompt and must still appear.
    const regenerated = await ctx.generate({ regenerate: true });
    expect(regenerated.items.map((item) => item.reason)).toEqual(["Reason B."]);
  });

  it("ignores prior feedback when the caller explicitly opts out", async () => {
    const mark = await ctx.person("Mark");
    await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.generate();
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.items[0]?.id ?? "",
    });

    const regenerated = await ctx.generator.generateBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: LOCAL_DATE,
      regenerate: true,
      ignorePriorFeedback: true,
    });
    expect(regenerated.items).toHaveLength(1);
  });

  it("suppresses dismissed candidates on a fresh next-day brief too", async () => {
    const mark = await ctx.person("Mark");
    // Due within today's window so it surfaces today and stays due (overdue) the
    // next day, letting us prove the dismissal carries across the date boundary.
    await ctx.dueFollowup(mark, "Reconnect.", new Date("2026-06-27T09:00:00Z"));

    const today = await ctx.generate();
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: today.items[0]?.id ?? "",
    });

    // A brand-new brief for the next local date still respects the dismissal.
    const nextDay = await ctx.generate({ localDate: NEXT_DATE });
    expect(nextDay.items).toHaveLength(0);
  });

  it("does not mutate the underlying follow-up when feedback is cleared", async () => {
    const mark = await ctx.person("Mark");
    const followup = await ctx.dueFollowup(mark, "Reconnect.");

    const first = await ctx.generate();
    await ctx.lifecycle.dismissBriefItem({
      ownerUserId: OWNER,
      briefItemId: first.items[0]?.id ?? "",
    });

    const stored = await ctx.agendaStore.getFollowup({
      ownerUserId: OWNER,
      followupId: followup.id,
    });
    expect(stored?.status).toBe("open");
  });
});
