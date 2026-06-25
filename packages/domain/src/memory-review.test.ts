import { describe, expect, it } from "vitest";
import { applyMemoryReviewEdit, canUseMemoryProactively, memoryReviewEditSchema } from "./memories";

const baseMemory = {
  content: "Mark may be switching jobs.",
  memoryType: "context" as const,
  sensitivity: "normal" as const,
  importance: 3,
};

describe("memoryReviewEditSchema", () => {
  it("accepts an empty edit (no-op)", () => {
    expect(memoryReviewEditSchema.parse({})).toEqual({});
  });

  it("rejects blank content", () => {
    expect(() => memoryReviewEditSchema.parse({ content: "   " })).toThrow();
  });
});

describe("applyMemoryReviewEdit", () => {
  it("leaves untouched fields when the edit omits them", () => {
    expect(applyMemoryReviewEdit(baseMemory, {})).toEqual(baseMemory);
  });

  it("lets a manual sensitivity override win", () => {
    const edited = applyMemoryReviewEdit(baseMemory, { sensitivity: "restricted" });
    expect(edited.sensitivity).toBe("restricted");
    expect(edited.content).toBe(baseMemory.content);
  });

  it("applies content, type, and importance corrections together", () => {
    const edited = applyMemoryReviewEdit(baseMemory, {
      content: "Mark switched jobs in May.",
      memoryType: "life_event",
      importance: 4,
    });

    expect(edited).toEqual({
      content: "Mark switched jobs in May.",
      memoryType: "life_event",
      sensitivity: "normal",
      importance: 4,
    });
  });
});

describe("restricted suggested memories are not proactive", () => {
  it("never treats a suggested memory as proactive context, even when normal", () => {
    expect(canUseMemoryProactively({ status: "suggested", sensitivity: "normal" })).toBe(false);
  });

  it("keeps restricted approved memories out of proactive surfaces unless directly requested", () => {
    expect(canUseMemoryProactively({ status: "approved", sensitivity: "restricted" })).toBe(false);
    expect(
      canUseMemoryProactively(
        { status: "approved", sensitivity: "restricted" },
        { directlyRequested: true },
      ),
    ).toBe(true);
  });
});
