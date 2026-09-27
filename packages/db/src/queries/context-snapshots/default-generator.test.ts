import { DETERMINISTIC_GENERATOR_VERSION, type SnapshotInputPack } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultSnapshotGenerator } from "../context-snapshots";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider("LLM-written relationship snapshot.");
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

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

  it("calls the configured model through the entry point when AI Gateway credentials are available", async () => {
    const generate = createDefaultSnapshotGenerator({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_SNAPSHOT_MODEL: "openai/test-model",
    });

    await expect(generate(inputPack())).resolves.toEqual({
      summary: "LLM-written relationship snapshot.",
      generatorVersion: "llm:openai/test-model",
    });
    const { models, sentPrompts, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["openai/test-model"]);
    expect(sentPrompts()).toEqual([expect.stringContaining("never infer, embellish, or invent")]);
    expect(sentPrompts()[0]).toContain("Write a brief, grounded relationship snapshot");
    expect(sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["openai"],
          tags: ["cost:background"],
        },
      },
    ]);
  });
});
