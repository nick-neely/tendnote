import type { CreateBriefItemInput, Followup, Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryFollowupLifecycleStore } from "../followups/in-memory-store";
import { createSuggestedFollowupReview } from "../followups/review";
import { createBriefSuggestedFollowupAcceptance } from "./accept-followup";
import { createInMemoryBriefLifecycleStore } from "./in-memory-store";
import { createBriefLifecycle } from "./lifecycle";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

async function setup() {
  const followupStore = createInMemoryFollowupLifecycleStore();
  const review = createSuggestedFollowupReview(followupStore);
  const briefStore = createInMemoryBriefLifecycleStore();
  const briefLifecycle = createBriefLifecycle(briefStore);

  const acceptance = createBriefSuggestedFollowupAcceptance({
    getBriefItem: (input) => briefStore.getBriefItem(input),
    markBriefItemActed: (input) => briefLifecycle.markBriefItemActed(input),
    acceptSuggestedFollowup: (input) => review.acceptSuggestedFollowup(input),
  });

  async function person(displayName: string): Promise<Person> {
    return followupStore.createPerson({
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

  async function suggestedFollowup(p: Person): Promise<Followup> {
    const sourceRecord = await followupStore.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mark mentioned a move.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const result = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: p.id,
      reason: "Ask whether the move happened.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      sourceRecordId: sourceRecord.id,
    });
    return result.followup;
  }

  async function briefWithItem(item: CreateBriefItemInput) {
    return briefStore.createBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: "2026-06-27",
      generationReason: "scheduled",
      generatedAt: new Date("2026-06-27T08:00:00Z"),
      windowStart: new Date("2026-06-27T00:00:00Z"),
      windowEnd: new Date("2026-06-28T00:00:00Z"),
      summary: null,
      summaryProvenance: null,
      supersededAt: null,
      items: [item],
    });
  }

  function suggestedFollowupItem(p: Person, followupId: string): CreateBriefItemInput {
    return {
      ownerUserId: OWNER,
      kind: "suggested_followup",
      personId: p.id,
      personDisplayName: p.displayName,
      title: `Review suggested follow-up for ${p.displayName}`,
      reason: "Ask whether the move happened.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      sourceRefs: [{ kind: "followup", id: followupId }],
      trustLevel: "tentative",
      sensitivity: "normal",
      scope: "private",
      householdId: null,
      rank: 1,
      status: "active",
      snoozedUntil: null,
    };
  }

  return {
    followupStore,
    briefStore,
    briefLifecycle,
    acceptance,
    person,
    suggestedFollowup,
    briefWithItem,
    suggestedFollowupItem,
  };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("accept suggested follow-up from a brief item", () => {
  it("promotes the suggested follow-up through the existing review mutation and marks the item acted-on", async () => {
    const mark = await ctx.person("Mark");
    const followup = await ctx.suggestedFollowup(mark);
    const brief = await ctx.briefWithItem(ctx.suggestedFollowupItem(mark, followup.id));
    const briefItemId = brief.items[0]?.id ?? "";

    const result = await ctx.acceptance.acceptBriefSuggestedFollowup({
      ownerUserId: OWNER,
      briefItemId,
    });

    // The underlying follow-up is now a real active reminder (existing lifecycle).
    expect(result.followup.followup.status).toBe("open");
    const stored = await ctx.followupStore.getFollowup({
      ownerUserId: OWNER,
      followupId: followup.id,
    });
    expect(stored?.status).toBe("open");

    // The brief item is acted-on only after the accept succeeded.
    expect(result.briefItem.status).toBe("acted_on");
  });

  it("leaves the brief item active when acceptance fails and does not hide it", async () => {
    const mark = await ctx.person("Mark");
    // Reference a follow-up id that does not exist, so the review mutation throws.
    const brief = await ctx.briefWithItem(
      ctx.suggestedFollowupItem(mark, "00000000-0000-0000-0000-000000000000"),
    );
    const briefItemId = brief.items[0]?.id ?? "";

    await expect(
      ctx.acceptance.acceptBriefSuggestedFollowup({ ownerUserId: OWNER, briefItemId }),
    ).rejects.toThrow();

    const item = await ctx.briefStore.getBriefItem({ ownerUserId: OWNER, briefItemId });
    expect(item?.status).toBe("active");
  });

  it("rejects brief items that are not suggested follow-ups", async () => {
    const mark = await ctx.person("Mark");
    const brief = await ctx.briefWithItem({
      ...ctx.suggestedFollowupItem(mark, "f1"),
      kind: "due_followup",
    });
    const briefItemId = brief.items[0]?.id ?? "";

    await expect(
      ctx.acceptance.acceptBriefSuggestedFollowup({ ownerUserId: OWNER, briefItemId }),
    ).rejects.toThrow(/suggested follow-up/i);
  });

  it("does not act on another owner's brief item", async () => {
    const mark = await ctx.person("Mark");
    const followup = await ctx.suggestedFollowup(mark);
    const brief = await ctx.briefWithItem(ctx.suggestedFollowupItem(mark, followup.id));
    const briefItemId = brief.items[0]?.id ?? "";

    await expect(
      ctx.acceptance.acceptBriefSuggestedFollowup({ ownerUserId: OTHER_OWNER, briefItemId }),
    ).rejects.toThrow(/not found/i);
  });
});
