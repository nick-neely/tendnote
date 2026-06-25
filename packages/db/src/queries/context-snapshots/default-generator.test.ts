import { DETERMINISTIC_GENERATOR_VERSION, type SnapshotInputPack } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultSnapshotGenerator } from "../context-snapshots";

const aiMock = vi.hoisted(() => ({
  gateway: vi.fn((modelId: string) => ({ modelId })),
  generateText: vi.fn(async () => ({ text: "LLM-written relationship snapshot." })),
}));

vi.mock("ai", () => aiMock);

const NOW = new Date("2026-01-01T00:00:00.000Z");

function inputPack(): SnapshotInputPack {
  return {
    person: {
      id: "person-1",
      ownerUserId: "user-1",
      displayName: "Mark Rivera",
      relationshipType: "friend",
      closenessLevel: 3,
      source: "manual",
      birthday: null,
      profileBlurb: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    approvedMemories: [],
    sourceRecords: [],
    suggestedMemories: [],
    followups: [],
  };
}

describe("createDefaultSnapshotGenerator", () => {
  it("uses the deterministic generator when AI Gateway credentials are unavailable", async () => {
    const generate = createDefaultSnapshotGenerator({});

    await expect(Promise.resolve(generate(inputPack()))).resolves.toMatchObject({
      generatorVersion: DETERMINISTIC_GENERATOR_VERSION,
    });
  });

  it("uses the configured gateway model version when AI Gateway credentials are available", async () => {
    const generate = createDefaultSnapshotGenerator({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_SNAPSHOT_MODEL: "openai/test-model",
    });

    await expect(generate(inputPack())).resolves.toEqual({
      summary: "LLM-written relationship snapshot.",
      generatorVersion: "llm:openai/test-model",
    });
    expect(aiMock.gateway).toHaveBeenCalledWith("openai/test-model");
    expect(aiMock.generateText).toHaveBeenCalledWith({
      model: { modelId: "openai/test-model" },
      prompt: expect.stringContaining("Write a short, warm relationship snapshot"),
    });
  });
});
