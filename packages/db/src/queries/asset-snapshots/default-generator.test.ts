import {
  type AssetSnapshotInputPack,
  DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultAssetSnapshotGenerator } from "../asset-snapshots";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider("LLM-written asset snapshot.");
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

const recordModelUsage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../usage-ledger", () => ({ recordModelUsage }));

const NOW = new Date("2026-06-01T00:00:00.000Z");

function inputPack(): AssetSnapshotInputPack {
  return {
    asset: {
      id: "asset-1",
      ownerUserId: "owner-1",
      name: "Refrigerator",
      kind: "appliance",
      status: "active",
      scope: "private",
      ownership: "member_owned",
      householdId: null,
      archivedAt: null,
      revision: 0,
      createdByUserId: "owner-1",
      lastActorUserId: "owner-1",
      createdAt: NOW,
      updatedAt: NOW,
    },
    memories: [],
    evidence: [],
    relatedAssets: [],
    personLinks: [],
    actions: [],
  };
}

describe("createDefaultAssetSnapshotGenerator", () => {
  it("uses the deterministic generator when AI Gateway credentials are unavailable", async () => {
    const generate = createDefaultAssetSnapshotGenerator({});

    await expect(
      Promise.resolve(generate(inputPack(), { accountId: "owner-1" })),
    ).resolves.toMatchObject({
      generatorVersion: DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION,
    });
    expect((await fakeGateway).models).toEqual([]);
  });

  it("calls the configured model through the entry point when AI Gateway credentials are available", async () => {
    const generate = createDefaultAssetSnapshotGenerator({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_SNAPSHOT_MODEL: "google/gemini-test",
    });

    await expect(generate(inputPack(), { accountId: "owner-1" })).resolves.toEqual({
      summary: "LLM-written asset snapshot.",
      generatorVersion: "llm:google/gemini-test",
    });
    const { models, sentPrompts, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-test"]);
    expect(sentPrompts()).toEqual([expect.stringContaining("Refrigerator")]);
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "owner-1", costCategory: "background" }),
    );
    expect(sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["vertex"],
          tags: ["cost:background"],
        },
      },
    ]);
  });
});
