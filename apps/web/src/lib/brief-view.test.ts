import type { BriefItem, BriefWithItems } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { toBriefView } from "./brief-view";

const NOW = new Date("2026-06-27T12:00:00Z");

function item(overrides: Partial<BriefItem> = {}): BriefItem {
  return {
    id: "item-1",
    briefId: "brief-1",
    ownerUserId: "user-1",
    kind: "due_followup",
    personId: "person-1",
    personDisplayName: "Mark",
    title: "Follow up with Mark",
    reason: "Reconnect about the move.",
    dueAt: new Date("2026-06-27T09:00:00Z"),
    sourceRefs: [{ kind: "followup", id: "f1" }],
    trustLevel: "active_reminder",
    sensitivity: "normal",
    scope: "private",
    householdId: null,
    rank: 1,
    status: "active",
    snoozedUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function brief(items: BriefItem[], summary: string | null = null): BriefWithItems {
  return {
    id: "brief-1",
    ownerUserId: "user-1",
    cadence: "daily",
    localDate: "2026-06-27",
    generationReason: "scheduled",
    generatedAt: NOW,
    windowStart: NOW,
    windowEnd: NOW,
    summary,
    summaryProvenance: null,
    supersededAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    items,
  };
}

describe("toBriefView", () => {
  it("maps active items to source-backed presentation fields", () => {
    const view = toBriefView(brief([item()], "One person today."), NOW);

    expect(view.cadence).toBe("daily");
    expect(view.summary).toBe("One person today.");
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      title: "Follow up with Mark",
      reason: "Reconnect about the move.",
      personId: "person-1",
      personName: "Mark",
      dueLabel: "Jun 27",
      dueState: "today",
      isSensitive: false,
      isSuggestedFollowup: false,
    });
  });

  it("flags suggested-followup items as acceptable", () => {
    const view = toBriefView(brief([item({ kind: "suggested_followup" })]), NOW);
    expect(view.items[0]?.isSuggestedFollowup).toBe(true);
  });

  it("excludes dismissed, snoozed, and acted-on items", () => {
    const view = toBriefView(
      brief([
        item({ id: "a", status: "active" }),
        item({ id: "b", status: "dismissed" }),
        item({ id: "c", status: "snoozed" }),
        item({ id: "d", status: "acted_on" }),
      ]),
      NOW,
    );

    expect(view.items.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("flags sensitive items and omits the due chip when there is no due date", () => {
    const view = toBriefView(
      brief([item({ sensitivity: "sensitive", dueAt: null, kind: "review_item" })]),
      NOW,
    );

    expect(view.items[0]?.isSensitive).toBe(true);
    expect(view.items[0]?.dueLabel).toBeNull();
    expect(view.items[0]?.dueState).toBeNull();
  });

  it("keeps the summary null when absent", () => {
    expect(toBriefView(brief([item()]), NOW).summary).toBeNull();
  });
});
