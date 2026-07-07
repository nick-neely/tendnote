import { describe, expect, it } from "vitest";
import {
  filterActionsByArea,
  pickVisibleAreaChips,
  resolveActiveAreaId,
} from "@/lib/general-action-area-filter";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";

function area(id: string, name = id, archived = false): GeneralActionAreaView {
  return { id, name, archived };
}

function action(id: string, areaId: string | null) {
  return { id, areaId };
}

describe("filterActionsByArea", () => {
  const actions = [
    action("a1", "home"),
    action("a2", "health"),
    action("a3", "home"),
    action("a4", null),
  ];

  it("returns everything when no area is selected (All)", () => {
    expect(filterActionsByArea(actions, null)).toEqual(actions);
  });

  it("narrows to the selected area", () => {
    expect(filterActionsByArea(actions, "home").map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("selecting then clearing restores the full list", () => {
    const narrowed = filterActionsByArea(actions, "health");
    expect(narrowed.map((a) => a.id)).toEqual(["a2"]);
    // "All" (null) restores.
    expect(filterActionsByArea(actions, null)).toHaveLength(4);
  });

  it("returns an empty list for an area with no matches", () => {
    expect(filterActionsByArea(actions, "travel")).toEqual([]);
  });
});

describe("resolveActiveAreaId", () => {
  const activeAreas = [area("home"), area("health")];

  it("keeps a selection that is still an active area", () => {
    expect(resolveActiveAreaId("home", activeAreas)).toBe("home");
  });

  it("falls back to All when the selected area is no longer active", () => {
    expect(resolveActiveAreaId("travel", activeAreas)).toBeNull();
    expect(resolveActiveAreaId(null, activeAreas)).toBeNull();
  });
});

describe("pickVisibleAreaChips", () => {
  const many = Array.from({ length: 9 }, (_, i) => area(`area-${i}`));

  it("shows all chips with no overflow when under the cap", () => {
    const { visible, overflow } = pickVisibleAreaChips(many.slice(0, 6), null);
    expect(visible).toHaveLength(6);
    expect(overflow).toBe(0);
  });

  it("caps the chips and reports the overflow count", () => {
    const { visible, overflow } = pickVisibleAreaChips(many, null);
    expect(visible).toHaveLength(6);
    expect(overflow).toBe(3);
  });

  it("keeps the selected area visible even when it sits past the cap", () => {
    const { visible, overflow } = pickVisibleAreaChips(many, "area-8");
    expect(visible.some((a) => a.id === "area-8")).toBe(true);
    expect(visible).toHaveLength(6);
    expect(overflow).toBe(3);
  });
});
