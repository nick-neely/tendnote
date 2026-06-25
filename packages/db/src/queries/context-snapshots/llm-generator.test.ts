import {
  DETERMINISTIC_GENERATOR_VERSION,
  type Person,
  type SnapshotInputPack,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createLlmSnapshotGenerator } from "./llm-generator";

const now = new Date("2026-01-01T00:00:00Z");

const person: Person = {
  id: "person-1",
  ownerUserId: "user-1",
  displayName: "Mark",
  firstName: null,
  lastName: null,
  birthday: null,
  relationshipType: "friend",
  closenessLevel: 3,
  profileBlurb: null,
  source: "manual",
  createdAt: now,
  updatedAt: now,
};

const pack: SnapshotInputPack = {
  person,
  approvedMemories: [],
  sourceRecords: [],
  suggestedMemories: [],
  followups: [],
};

describe("createLlmSnapshotGenerator", () => {
  it("passes a built prompt to the model and returns its prose", async () => {
    const model = vi.fn().mockResolvedValue("  Mark is a close friend.  ");
    const generate = createLlmSnapshotGenerator({ model, version: "llm:test-model" });

    const result = await generate(pack);

    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0]?.[0].prompt).toContain("Mark");
    // Output is trimmed prose tagged with the adapter's version — no
    // reference/policy decisions in the adapter.
    expect(result).toEqual({
      summary: "Mark is a close friend.",
      generatorVersion: "llm:test-model",
    });
  });

  it("falls back to deterministic prose tagged with the fallback's version on empty output", async () => {
    const model = vi.fn().mockResolvedValue("   ");
    const generate = createLlmSnapshotGenerator({ model, version: "llm:test-model" });

    const result = await generate(pack);

    expect(result.summary).toContain("Mark");
    // Provenance reflects the real producer: deterministic, not the model.
    expect(result.generatorVersion).toBe(DETERMINISTIC_GENERATOR_VERSION);
  });

  it("uses a provided fallback generator on empty model output", async () => {
    const model = vi.fn().mockResolvedValue("");
    const generate = createLlmSnapshotGenerator({
      model,
      version: "llm:test-model",
      fallback: () => ({ summary: "fallback prose", generatorVersion: "fallback-v1" }),
    });

    expect(await generate(pack)).toEqual({
      summary: "fallback prose",
      generatorVersion: "fallback-v1",
    });
  });

  it("propagates model errors so the builder can fail open", async () => {
    const model = vi.fn().mockRejectedValue(new Error("model down"));
    const generate = createLlmSnapshotGenerator({ model, version: "llm:test-model" });

    await expect(generate(pack)).rejects.toThrow("model down");
  });
});
