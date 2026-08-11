import { describe, expect, it } from "vitest";
import { buildCreateActionInput } from "./general-action-create-input";

type Fields = Parameters<typeof buildCreateActionInput>[0];

function fields(overrides: Partial<Fields> = {}): Fields {
  return {
    title: "Book the venue",
    notes: "",
    dueDate: "",
    recurrence: null,
    links: [],
    assetHints: [],
    personIds: [],
    areaId: null,
    visibilityChoice: "only_me",
    selectedUserIds: [],
    ...overrides,
  };
}

describe("create-action payload", () => {
  it("sends only the title and audience when nothing optional was filled in", () => {
    expect(buildCreateActionInput(fields())).toEqual({
      title: "Book the venue",
      visibilityChoice: "only_me",
    });
  });

  /** An empty note is not a note. Absent and blank must not reach the seam differently. */
  it("omits every optional field left empty rather than sending a blank", () => {
    const payload = buildCreateActionInput(fields({ notes: "", dueDate: "" }));
    expect(payload).not.toHaveProperty("notes");
    expect(payload).not.toHaveProperty("dueAt");
    expect(payload).not.toHaveProperty("recurrence");
    expect(payload).not.toHaveProperty("links");
    expect(payload).not.toHaveProperty("assetHints");
    expect(payload).not.toHaveProperty("personIds");
    expect(payload).not.toHaveProperty("areaId");
    expect(payload).not.toHaveProperty("selectedUserIds");
  });

  it("carries every optional field the member actually filled in", () => {
    const payload = buildCreateActionInput(
      fields({
        notes: "Ask about parking",
        dueDate: "2026-09-01",
        recurrence: { interval: 1, unit: "week" },
        links: [{ url: "https://example.com", label: "Venue" }],
        assetHints: ["Kettle"],
        personIds: ["person-1"],
        areaId: "area-1",
        selectedUserIds: ["user-mara"],
        visibilityChoice: "selected_members",
      }),
    );
    expect(payload).toMatchObject({
      title: "Book the venue",
      notes: "Ask about parking",
      dueAt: "2026-09-01",
      personIds: ["person-1"],
      areaId: "area-1",
      selectedUserIds: ["user-mara"],
      visibilityChoice: "selected_members",
    });
    expect(payload.links).toHaveLength(1);
    expect(payload.assetHints).toEqual(["Kettle"]);
  });

  /**
   * ADR 0214: a household-native Action is owned by the workspace, while an Area
   * and person links are one member's own records. The composer hides both
   * fields for that audience, so whatever they were carrying, often an Area
   * pre-filled by the active filter, must be dropped here rather than sent into
   * a refusal the member never asked for.
   */
  it("drops the Area and person links a household-native Action may not own", () => {
    const payload = buildCreateActionInput(
      fields({
        visibilityChoice: "whole_household",
        personIds: ["person-1"],
        areaId: "area-1",
        notes: "Still kept",
      }),
    );
    expect(payload).not.toHaveProperty("personIds");
    expect(payload).not.toHaveProperty("areaId");
    expect(payload.notes).toBe("Still kept");
    expect(payload.visibilityChoice).toBe("whole_household");
  });

  it("keeps the Area and person links for every other audience", () => {
    for (const choice of ["only_me", "selected_members"] as const) {
      const payload = buildCreateActionInput(
        fields({ visibilityChoice: choice, personIds: ["person-1"], areaId: "area-1" }),
      );
      expect(payload.personIds).toEqual(["person-1"]);
      expect(payload.areaId).toBe("area-1");
    }
  });
});
