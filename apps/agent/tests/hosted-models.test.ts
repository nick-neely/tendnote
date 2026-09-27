import { generateText, type LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import agent from "../agent/agent";
import { generateConversationTitle } from "../agent/hooks/assistant-conversation";
import memoryCurator from "../agent/subagents/memory_curator/agent";
import messageDrafter from "../agent/subagents/message_drafter/agent";
import privacyGuard from "../agent/subagents/privacy_guard/agent";
import relationshipStrategist from "../agent/subagents/relationship_strategist/agent";

// The real AI SDK runs against a fake gateway, so the test sees the request each
// Eve model actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("@tendnote/db/queries/model-call-fixtures");
  return fakeGatewayProvider("Weekend plans with Mara");
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

/** Gemini on Vertex only, never the Gemini Developer API, charged to interactive Eve. */
const INTERACTIVE_VERTEX = {
  gateway: {
    zeroDataRetention: true,
    disallowPromptTraining: true,
    only: ["vertex"],
    tags: ["cost:interactive"],
  },
};

const eveModels = {
  agent,
  memory_curator: memoryCurator,
  message_drafter: messageDrafter,
  privacy_guard: privacyGuard,
  relationship_strategist: relationshipStrategist,
};

describe("Eve's hosted models", () => {
  it.each(Object.entries(eveModels))(
    "%s resolves its model through the entry point",
    async (_, definition) => {
      // Eve builds its models at import, so only this call's requests are compared.
      const fake = await fakeGateway;
      const earlierCalls = fake.calls().length;

      await generateText({ model: definition.model as LanguageModel, prompt: "hi" });

      expect(definition.model).toMatchObject({ modelId: "google/gemini-3.7-flash" });
      expect(fake.sentProviderOptions().slice(earlierCalls)).toEqual([INTERACTIVE_VERTEX]);
    },
  );

  it("titles a conversation through the entry point", async () => {
    const fake = await fakeGateway;
    const earlierModels = fake.models.length;

    await expect(
      generateConversationTitle({ userMessage: "Plan the weekend", assistantReply: "Sure." }),
    ).resolves.toBe("Weekend plans with Mara");
    const [titleModel] = fake.models.slice(earlierModels);
    expect(titleModel?.modelId).toBe("google/gemini-3.7-flash");
    expect(titleModel?.doGenerateCalls.map((c) => c.providerOptions)).toEqual([INTERACTIVE_VERTEX]);
    expect(fake.sentPrompts().at(-1)).toContain("Plan the weekend");
  });
});
