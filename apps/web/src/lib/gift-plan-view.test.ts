import type { GiftPlanDetail, GiftPlanWithContext } from "@tendnote/db/queries/gift-plans";
import type { GiftIdea, GiftPlanEvent } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  type GiftPlanPeopleLabels,
  toGiftIdeaView,
  toGiftPlanDetailView,
  toGiftPlanView,
} from "./gift-plan-view";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const CALLER = "user-ana";
const MARA = "user-mara";
const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const PEOPLE: GiftPlanPeopleLabels = {
  callerUserId: CALLER,
  names: { [CALLER]: "Ana", [MARA]: "Mara" },
};

function plan(overrides: Partial<GiftPlanWithContext> = {}): GiftPlanWithContext {
  return {
    id: PLAN_ID,
    ownerUserId: CALLER,
    subjectName: "Rowan",
    occasion: "Birthday",
    occasionOn: null,
    subjectPersonId: null,
    surpriseSubjectUserId: null,
    status: "active",
    scope: "private",
    householdId: null,
    lastActorUserId: null,
    revision: 3,
    createdAt: NOW,
    updatedAt: NOW,
    householdName: null,
    sharedWithUserIds: [],
    ideaCount: 2,
    claimedIdeaCount: 1,
    ...overrides,
  };
}

function idea(overrides: Partial<GiftIdea> = {}): GiftIdea {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    giftPlanId: PLAN_ID,
    contributorUserId: CALLER,
    title: "A good kettle",
    note: null,
    url: null,
    claimedByUserId: null,
    claimedAt: null,
    lastActorUserId: null,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function event(kind: GiftPlanEvent["kind"], actorUserId: string | null): GiftPlanEvent {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    giftPlanId: PLAN_ID,
    kind,
    actorUserId,
    detailJson: {},
    createdAt: NOW,
  };
}

function summaryFor(kind: GiftPlanEvent["kind"], actorUserId: string | null): string {
  const detail: GiftPlanDetail = {
    plan: plan(),
    ideas: [],
    events: [event(kind, actorUserId)],
  };
  const [entry] = toGiftPlanDetailView(detail, PEOPLE, NOW).history;
  if (!entry) throw new Error("expected one history entry");
  return entry.summary;
}

describe("gift plan timing", () => {
  const on = (iso: string) => toGiftPlanView(plan({ occasionOn: new Date(iso) }), PEOPLE, NOW);

  it("says nothing at all when no date was named", () => {
    expect(toGiftPlanView(plan(), PEOPLE, NOW).timingLabel).toBeNull();
  });

  it("names the near dates in the words a person would use", () => {
    expect(on("2026-08-10T00:00:00.000Z").timingLabel).toBe("Today");
    expect(on("2026-08-11T00:00:00.000Z").timingLabel).toBe("Tomorrow");
    expect(on("2026-08-15T00:00:00.000Z").timingLabel).toBe("In 5 days");
    expect(on("2026-08-31T00:00:00.000Z").timingLabel).toBe("In 3 weeks");
  });

  /** A plan that slipped is not a failure, so there is no count of days lost. */
  it("states a date has gone by without counting how long ago", () => {
    expect(on("2026-08-01T00:00:00.000Z").timingLabel).toBe("Date has passed");
  });

  it("falls back to the date itself once it is far enough out", () => {
    expect(on("2026-12-24T00:00:00.000Z").timingLabel).toBe("December 24");
  });

  /**
   * The day arithmetic above is UTC-normalised, and this fallback has to agree
   * with it. While it formatted in the reader's own zone, a date stored as
   * December 24 read "December 23" anywhere west of UTC — so the zone is forced
   * here rather than left to whichever one the runner happens to sit in.
   */
  it("names the stored day west of UTC, where the reader's own zone trails it", () => {
    withTimeZone("America/New_York", () => {
      expect(on("2026-12-24T00:00:00.000Z").timingLabel).toBe("December 24");
    });
  });
});

/** Runs `body` with the process reading dates in `timeZone`, then restores it. */
function withTimeZone(timeZone: string, body: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    body();
  } finally {
    process.env.TZ = previous;
  }
}

describe("gift plan view", () => {
  it("keeps an active plan free of a status chip and open to contributions", () => {
    const view = toGiftPlanView(plan(), PEOPLE, NOW);
    expect(view.statusLabel).toBeNull();
    expect(view.closedReason).toBeNull();
    expect(view.acceptsCommitments).toBe(true);
  });

  it("says why a closed plan is closed and how to reopen it", () => {
    const celebrated = toGiftPlanView(plan({ status: "celebrated" }), PEOPLE, NOW);
    expect(celebrated.statusLabel).toBe("Celebrated");
    expect(celebrated.closedReason).toContain("Reopen it");
    expect(celebrated.acceptsCommitments).toBe(false);
    expect(toGiftPlanView(plan({ status: "archived" }), PEOPLE, NOW).statusLabel).toBe("Archived");
  });

  it("names a shared plan's audience the same way every other surface does", () => {
    expect(
      toGiftPlanView(plan({ scope: "shared", sharedWithUserIds: [MARA] }), PEOPLE, NOW)
        .visibilityLabel,
    ).toBe("Shared with 1 person");
    expect(
      toGiftPlanView(plan({ scope: "shared", sharedWithUserIds: [MARA, "user-ben"] }), PEOPLE, NOW)
        .visibilityLabel,
    ).toBe("Shared with 2 people");
  });

  it("falls back to the editor choice when a shared plan has nobody on it yet", () => {
    const view = toGiftPlanView(plan({ scope: "shared", sharedWithUserIds: [] }), PEOPLE, NOW);
    expect(view.visibilityLabel).toBe("Specific people");
  });

  it("reports ownership from the caller rather than from the surface", () => {
    expect(toGiftPlanView(plan(), PEOPLE, NOW).owned).toBe(true);
    expect(toGiftPlanView(plan({ ownerUserId: MARA }), PEOPLE, NOW).owned).toBe(false);
  });

  it("reports surprise protection as a flag, never as the subject's id", () => {
    const view = toGiftPlanView(plan({ surpriseSubjectUserId: MARA }), PEOPLE, NOW);
    expect(view.surprise).toBe(true);
    expect(JSON.stringify(view)).not.toContain(MARA);
  });
});

describe("gift idea view", () => {
  it("calls the caller's own contribution theirs", () => {
    const view = toGiftIdeaView(idea(), PEOPLE);
    expect(view.contributorLabel).toBe("You");
    expect(view.mine).toBe(true);
  });

  it("names another member rather than showing an id", () => {
    const view = toGiftIdeaView(idea({ contributorUserId: MARA }), PEOPLE);
    expect(view.contributorLabel).toBe("Mara");
    expect(view.mine).toBe(false);
  });

  it("survives a contributor the roster can no longer name", () => {
    expect(toGiftIdeaView(idea({ contributorUserId: "user-gone" }), PEOPLE).contributorLabel).toBe(
      "Someone in your household",
    );
  });

  it("says who holds a claim, and leaves it null when nobody does", () => {
    expect(toGiftIdeaView(idea(), PEOPLE).claimedByLabel).toBeNull();
    expect(toGiftIdeaView(idea({ claimedByUserId: CALLER }), PEOPLE).claimedByLabel).toBe("You");
    expect(toGiftIdeaView(idea({ claimedByUserId: MARA }), PEOPLE).claimedByLabel).toBe("Mara");
    expect(toGiftIdeaView(idea({ claimedByUserId: MARA }), PEOPLE).claimedByMe).toBe(false);
  });
});

describe("gift plan history", () => {
  it("writes every event kind as a sentence about the member who acted", () => {
    expect(summaryFor("created", MARA)).toBe("Mara started this plan");
    expect(summaryFor("edited", MARA)).toBe("Mara updated the details");
    expect(summaryFor("audience_changed", MARA)).toBe("Mara changed visibility");
    expect(summaryFor("surprise_protected", MARA)).toBe("Mara turned on surprise protection");
    expect(summaryFor("surprise_lifted", MARA)).toBe("Mara turned off surprise protection");
    expect(summaryFor("idea_added", MARA)).toBe("Mara added an idea");
    expect(summaryFor("idea_edited", MARA)).toBe("Mara edited their idea");
    expect(summaryFor("idea_removed", MARA)).toBe("Mara removed their idea");
    expect(summaryFor("idea_claimed", MARA)).toBe("Mara said they'd handle an idea");
    expect(summaryFor("idea_released", MARA)).toBe("Mara let an idea go");
    expect(summaryFor("celebrated", MARA)).toBe("Mara marked this celebrated");
    expect(summaryFor("archived", MARA)).toBe("Mara archived this plan");
    expect(summaryFor("reopened", MARA)).toBe("Mara reopened this plan");
  });

  /**
   * The possessive has to follow the subject. "You said they'd handle an idea"
   * about the idea the reader just claimed reads as a mistake about who acted.
   */
  it("puts the reader's own actions in the second person, possessives included", () => {
    expect(summaryFor("created", CALLER)).toBe("You started this plan");
    expect(summaryFor("idea_edited", CALLER)).toBe("You edited your idea");
    expect(summaryFor("idea_removed", CALLER)).toBe("You removed your idea");
    expect(summaryFor("idea_claimed", CALLER)).toBe("You said you'd handle an idea");
  });

  it("names an actor the roster has lost without falling back to an id", () => {
    expect(summaryFor("idea_added", "user-gone")).toBe("Someone in your household added an idea");
  });

  /** Access ending is the one event nobody performed, so no name may lead it. */
  it("attributes an access-driven audience change to nobody at all", () => {
    expect(summaryFor("audience_changed", null)).toBe(
      "This plan went private when household access ended",
    );
  });

  it("attributes any other actorless event to Tendnote rather than to a member", () => {
    expect(summaryFor("archived", null)).toBe("Tendnote archived this plan");
  });

  it("carries each entry's own id and timestamp", () => {
    const detail: GiftPlanDetail = {
      plan: plan(),
      ideas: [idea()],
      events: [event("created", CALLER)],
    };
    const view = toGiftPlanDetailView(detail, PEOPLE, NOW);
    expect(view.history[0]?.at).toBe(NOW.toISOString());
    expect(view.ideas).toHaveLength(1);
    expect(view.plan.id).toBe(PLAN_ID);
  });
});
