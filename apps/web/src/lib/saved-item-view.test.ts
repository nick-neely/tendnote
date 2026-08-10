import type { SavedItemWithContext } from "@tendnote/db/queries/saved-items";
import { describe, expect, it } from "vitest";
import { toSavedItemView } from "./saved-item-view";

const NOW = new Date(2026, 2, 14, 12);
const UPDATED_AT = new Date("2026-03-13T18:30:00.000Z");
const MEMBER_NAMES = new Map([
  ["owner-1", "Mara"],
  ["member-2", "Ben"],
]);

function savedItem(overrides: Partial<SavedItemWithContext> = {}): SavedItemWithContext {
  return {
    id: "saved-item-1",
    ownerUserId: "owner-1",
    ownership: "member_owned",
    version: 1,
    kind: "note",
    title: "Read about rain gardens",
    content: "A useful guide.",
    url: null,
    status: "active",
    bringBackAt: new Date(2026, 2, 12),
    bringBackTimeSemantics: "date_only",
    sourceRecordId: "source-1",
    scope: "shared",
    householdId: "household-1",
    resolvedAt: null,
    resolutionReason: null,
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: UPDATED_AT,
    sharedWithUserIds: ["member-1", "member-2"],
    householdName: "Home",
    outcomes: [],
    ...overrides,
  };
}

function householdItem(overrides: Partial<SavedItemWithContext> = {}): SavedItemWithContext {
  return savedItem({
    ownerUserId: null,
    ownership: "household_native",
    scope: "household",
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    sharedWithUserIds: [],
    ...overrides,
  });
}

describe("toSavedItemView", () => {
  it("maps Saved Item fields around domain-derived surfacing", () => {
    const view = toSavedItemView(savedItem(), { callerUserId: "owner-1", now: NOW });

    expect(view.kindLabel).toBe("Note");
    expect(view.bringBackAt).toBe(new Date(2026, 2, 12).toISOString());
    expect(view.visibilityLabel).toBe("Specific people · 2");
    expect(view.owned).toBe(true);
    expect(view.ownerUserId).toBe("owner-1");
    expect(view.ownership).toBe("member_owned");
    expect(view.version).toBe(1);
    expect(view.revision).toBe(UPDATED_AT.toISOString());
  });

  it("names the member who shared an item the viewer does not own, and leaves it read-only", () => {
    const view = toSavedItemView(savedItem(), {
      callerUserId: "member-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });

    expect(view.visibilityLabel).toBe("Shared by Mara");
    expect(view.owned).toBe(false);
    expect(view.canEdit).toBe(false);
    expect(view.canDeleteEvidence).toBe(false);
  });

  it("falls back to a neutral word rather than rendering an unknown member's id", () => {
    const view = toSavedItemView(savedItem(), { callerUserId: "member-1", now: NOW });

    expect(view.visibilityLabel).toBe("Shared by a member");
    expect(view.visibilityLabel).not.toContain("owner-1");
  });

  it("labels a household-native item Household and gives every member the same authority", () => {
    const view = toSavedItemView(householdItem({ version: 4 }), {
      callerUserId: "member-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });

    expect(view.visibilityLabel).toBe("Household");
    expect(view.ownerUserId).toBeNull();
    expect(view.owned).toBe(false);
    expect(view.canEdit).toBe(true);
    expect(view.version).toBe(4);
  });

  it("never offers evidence deletion on a household-native item", () => {
    const view = toSavedItemView(householdItem(), {
      callerUserId: "owner-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });

    expect(view.canDeleteEvidence).toBe(false);
    expect(view.canEdit).toBe(true);
  });

  it("attributes a household-native item to its creator and last actor", () => {
    const view = toSavedItemView(householdItem({ lastActorUserId: "member-2" }), {
      callerUserId: "member-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });

    expect(view.createdByLabel).toBe("Created by Mara");
    expect(view.lastChangedByLabel).toBe("Last changed by Ben");
  });

  it("stays quiet about the viewer's own writing and about an unchanged creator", () => {
    const sameActor = toSavedItemView(householdItem(), {
      callerUserId: "member-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });
    const viewerWrote = toSavedItemView(householdItem({ lastActorUserId: "member-1" }), {
      callerUserId: "member-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });
    const viewerCreated = toSavedItemView(
      householdItem({ createdByUserId: "member-1", lastActorUserId: "member-1" }),
      { callerUserId: "member-1", now: NOW, memberNames: MEMBER_NAMES },
    );

    expect(sameActor.lastChangedByLabel).toBeNull();
    expect(viewerWrote.lastChangedByLabel).toBeNull();
    expect(viewerCreated.createdByLabel).toBeNull();
  });

  it("keeps a member-owned item free of household provenance lines", () => {
    const view = toSavedItemView(savedItem({ lastActorUserId: "member-2" }), {
      callerUserId: "member-1",
      now: NOW,
      memberNames: MEMBER_NAMES,
    });

    expect(view.createdByLabel).toBeNull();
    expect(view.lastChangedByLabel).toBeNull();
  });
});
