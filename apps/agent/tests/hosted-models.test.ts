import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateText, type LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { generateConversationTitle } from "../agent/hooks/assistant-conversation";
import { eveSessionAccount } from "../agent/lib/eve-session-account";

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

const recordModelUsage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tendnote/db/queries/usage-ledger", () => ({ recordModelUsage }));

/** Gemini on Vertex only, never the Gemini Developer API, charged to interactive Eve. */
const INTERACTIVE_VERTEX = {
  gateway: {
    zeroDataRetention: true,
    disallowPromptTraining: true,
    only: ["vertex"],
    tags: ["cost:interactive"],
  },
};

const eveAgentModules = {
  agent: () => import("../agent/agent"),
  memory_curator: () => import("../agent/subagents/memory_curator/agent"),
  message_drafter: () => import("../agent/subagents/message_drafter/agent"),
  privacy_guard: () => import("../agent/subagents/privacy_guard/agent"),
  relationship_strategist: () => import("../agent/subagents/relationship_strategist/agent"),
};

type EveModelResolver = {
  resolveRuntimeModelReference(
    reference: object,
    scope: { moduleMap: object; nodeId: string },
  ): Promise<LanguageModel>;
};

type EveContextRuntime = {
  ContextContainer: new () => { set(key: unknown, value: unknown): unknown };
  contextStorage: { run<T>(context: object, callback: () => Promise<T>): Promise<T> };
  SessionKey: unknown;
};

const eveRoot = dirname(createRequire(import.meta.url).resolve("eve/package.json"));

async function loadEveInternal<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(join(eveRoot, relativePath)).href)) as T;
}

/** Runs `callback` inside Eve's real context store, as a session of `principalId`. */
async function inEveSession<T>(principalId: string, callback: () => Promise<T>) {
  const [container, keys] = await Promise.all([
    loadEveInternal<Pick<EveContextRuntime, "ContextContainer" | "contextStorage">>(
      "dist/src/context/container.js",
    ),
    loadEveInternal<Pick<EveContextRuntime, "SessionKey">>("dist/src/context/keys.js"),
  ]);
  const ctx = new container.ContextContainer();
  const current = { principalId, principalType: "user", authenticator: "better-auth" };
  ctx.set(keys.SessionKey, {
    sessionId: "session-1",
    auth: { current, initiator: current },
    turn: { id: "turn_0", sequence: 0 },
  });
  return container.contextStorage.run(ctx, callback);
}

/**
 * Resolves a model the way Eve's runtime does for a turn and its compaction:
 * from the compiled, source-backed model reference to the authored module's
 * export. Eve swaps in a mock model under `NODE_ENV=test`, so the real resolution
 * path runs with that switch set aside.
 */
async function resolveAsEveRuntime(loadModule: () => Promise<object>) {
  const { resolveRuntimeModelReference } = await loadEveInternal<EveModelResolver>(
    "dist/src/runtime/agent/resolve-model.js",
  );
  const reference = {
    id: "google/gemini-3.7-flash",
    source: { sourceKind: "module", logicalPath: "agent.ts", sourceId: "agent.ts" },
    routing: { kind: "gateway", target: "google" },
  };
  const moduleMap = { nodes: { node: { modules: { "agent.ts": await loadModule() } } } };
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return await resolveRuntimeModelReference(reference, { moduleMap, nodeId: "node" });
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
}

describe("Eve's hosted models", () => {
  it.each(Object.entries(eveAgentModules))(
    "%s runs turns on the entry point's model",
    async (_, loadModule) => {
      const model = await resolveAsEveRuntime(loadModule);
      // Eve builds its models at import, so only this call's requests are compared.
      const fake = await fakeGateway;
      const earlierCalls = fake.calls().length;

      recordModelUsage.mockClear();

      await inEveSession("owner-1", () => generateText({ model, prompt: "hi" }));

      expect(model).toMatchObject({ modelId: "google/gemini-3.7-flash" });
      expect(fake.sentProviderOptions().slice(earlierCalls)).toEqual([INTERACTIVE_VERTEX]);
      expect(recordModelUsage).toHaveBeenCalledWith({
        accountId: "owner-1",
        modelId: "google/gemini-3.7-flash",
        costCategory: "interactive",
        inputTokens: 3,
        outputTokens: 2,
      });
    },
  );

  it("meters each call to the Eve session it runs in", async () => {
    await expect(inEveSession("owner-2", async () => eveSessionAccount())).resolves.toBe("owner-2");
    expect(eveSessionAccount()).toBeNull();
  });

  it("titles a conversation through the entry point", async () => {
    const fake = await fakeGateway;
    const earlierModels = fake.models.length;

    recordModelUsage.mockClear();

    await expect(
      generateConversationTitle({
        ownerUserId: "owner-1",
        userMessage: "Plan the weekend",
        assistantReply: "Sure.",
      }),
    ).resolves.toBe("Weekend plans with Mara");
    const [titleModel] = fake.models.slice(earlierModels);
    expect(titleModel?.modelId).toBe("google/gemini-3.7-flash");
    expect(titleModel?.doGenerateCalls.map((c) => c.providerOptions)).toEqual([INTERACTIVE_VERTEX]);
    expect(fake.sentPrompts().at(-1)).toContain("Plan the weekend");
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "owner-1", costCategory: "interactive" }),
    );
  });
});
