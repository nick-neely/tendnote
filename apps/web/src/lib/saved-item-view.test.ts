import type { SavedItemWithContext } from "@tendnote/db/queries/saved-items";
import { describe, expect, it } from "vitest";
import { toSavedItemView } from "./saved-item-view";

const NOW = new Date(2026, 2, 14, 12);
const UPDATED_AT = new Date("2026-03-13T18:30:00.000Z");

function savedItem(overrides: Partial<SavedItemWithContext> = {}): SavedItemWithContext {
  return {
    id: "saved-item-1",
    ownerUserId: "owner-1",
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

describe("toSavedItemView", () => {
  it("maps Saved Item fields around domain-derived surfacing", () => {
    const view = toSavedItemView(savedItem(), NOW, null, "member-1");

    expect(view.kindLabel).toBe("Note");
    expect(view.bringBackAt).toBe(new Date(2026, 2, 12).toISOString());
    expect(view.visibilityLabel).toBe("Specific people · 2");
    expect(view.owned).toBe(false);
    expect(view.ownerUserId).toBe("owner-1");
    expect(view.revision).toBe(UPDATED_AT.toISOString());
  });
});
