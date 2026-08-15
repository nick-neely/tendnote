import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import gate from "../agent/tools/eve_mode_gate";

type Principal = { principalType: string; attributes?: Record<string, string> };

type EveHarnessTools = {
  buildToolSetFromDefinitions(input: { tools: readonly unknown[] }): Record<string, EveTool>;
  buildToolSetWithProviderTools(input: {
    modelReference: { id: string };
    tools: Map<string, unknown>;
    webSearchProvider: string;
  }): Promise<Record<string, EveTool>>;
};

type EveContext = {
  set(key: unknown, value: unknown): unknown;
};

type EveContextStorage = {
  run<T>(context: EveContext, callback: () => Promise<T>): Promise<T>;
};

type EveTool = {
  readonly type?: string;
  readonly id?: string;
  readonly isProviderExecuted?: boolean;
  readonly execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

type EveRuntime = {
  ContextContainer: new () => EveContext;
  AuthKey: unknown;
  InitiatorAuthKey: unknown;
  SessionIdKey: unknown;
  SessionKey: unknown;
  contextStorage: EveContextStorage;
  dispatchDynamicToolEvent(input: {
    ctx: EveContext;
    resolvers: readonly [RuntimeResolver];
    event: { type: "turn.started"; data: { sequence: number; turnId: string } };
    messages: readonly unknown[];
  }): Promise<void>;
  buildDynamicTools(ctx: EveContext): readonly unknown[];
};

type RuntimeResolver = {
  slug: string;
  eventNames: readonly ["turn.started"];
  events: Record<string, NonNullable<(typeof gate.events)["turn.started"]>>;
  sourceKind: "module";
  sourceId: string;
  logicalPath: string;
};

const eveRoot = dirname(createRequire(import.meta.url).resolve("eve/package.json"));

async function loadEveInternal<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(join(eveRoot, relativePath)).href)) as T;
}

async function loadRuntime(): Promise<{
  runtime: EveRuntime;
  tools: EveHarnessTools;
  webSearch: unknown;
}> {
  const [container, keys, lifecycle, dynamicTools, harnessTools, webSearch] = await Promise.all([
    loadEveInternal<Pick<EveRuntime, "ContextContainer" | "contextStorage">>(
      "dist/src/context/container.js",
    ),
    loadEveInternal<
      Pick<EveRuntime, "AuthKey" | "InitiatorAuthKey" | "SessionIdKey" | "SessionKey">
    >("dist/src/context/keys.js"),
    loadEveInternal<Pick<EveRuntime, "dispatchDynamicToolEvent">>(
      "dist/src/context/dynamic-tool-lifecycle.js",
    ),
    loadEveInternal<Pick<EveRuntime, "buildDynamicTools">>(
      "dist/src/context/build-dynamic-tools.js",
    ),
    loadEveInternal<EveHarnessTools>("dist/src/harness/tools.js"),
    loadEveInternal<{ WEB_SEARCH_TOOL_DEFINITION: unknown }>(
      "dist/src/runtime/framework-tools/web-search.js",
    ),
  ]);

  return {
    runtime: { ...container, ...keys, ...lifecycle, ...dynamicTools },
    tools: harnessTools,
    webSearch: webSearch.WEB_SEARCH_TOOL_DEFINITION,
  };
}

const WEB_OWNER: Principal = { principalType: "user", attributes: { channel: "eve" } };

const FORBIDDEN_SESSIONS = [
  ["discord_capture", { principalType: "user", attributes: { channel: "discord" } }],
  ["scheduled_workflow", { principalType: "runtime" }],
  ["restricted", null],
  ["restricted", { principalType: "user", attributes: {} }],
  ["restricted", { principalType: "user", attributes: { channel: "unknown" } }],
] as const;

function runtimeResolver(): RuntimeResolver {
  return {
    slug: "eve_mode_gate",
    eventNames: ["turn.started"],
    events: gate.events,
    sourceKind: "module",
    sourceId: "apps/agent/agent/tools/eve_mode_gate.ts",
    logicalPath: "tools/eve_mode_gate",
  };
}

async function buildRuntimeToolSets(current: Principal | null) {
  const { runtime, tools, webSearch } = await loadRuntime();
  const ctx = new runtime.ContextContainer();
  ctx.set(runtime.SessionIdKey, "session-1");
  ctx.set(runtime.AuthKey, current);
  ctx.set(runtime.InitiatorAuthKey, current);
  ctx.set(runtime.SessionKey, {
    sessionId: "session-1",
    auth: { current, initiator: current },
    turn: { id: "turn_0", sequence: 0 },
  });

  await runtime.dispatchDynamicToolEvent({
    ctx,
    resolvers: [runtimeResolver()],
    event: { type: "turn.started", data: { sequence: 0, turnId: "turn_0" } },
    messages: [],
  });

  const staticTools = new Map([["web_search", webSearch]]);
  const providerTools = await tools.buildToolSetWithProviderTools({
    modelReference: { id: "anthropic/claude-haiku-4.5" },
    tools: staticTools,
    webSearchProvider: "exa",
  });
  const dynamicTools = tools.buildToolSetFromDefinitions({
    tools: runtime.buildDynamicTools(ctx),
  });

  // This is the merge in Eve 0.32's tool-loop: provider tools are injected from
  // the advertised static map first, then dynamic turn tools win by name.
  return { ctx, runtime, providerTools, finalTools: { ...providerTools, ...dynamicTools } };
}

describe("Eve mode gate at the 0.32 runtime tool merge", () => {
  it.each(
    FORBIDDEN_SESSIONS,
  )("shadows provider web_search before a %s session can execute it", async (mode, principal) => {
    const { ctx, runtime, providerTools, finalTools } = await buildRuntimeToolSets(principal);
    const providerSearch = providerTools.web_search;
    const finalSearch = finalTools.web_search;

    // Prove this test exercised buildToolSetWithProviderTools, rather than
    // merely inspecting the gate: the static framework definition is turned
    // into Eve's provider-executed search tool before the dynamic overlay.
    expect(providerSearch?.type).toBe("provider");
    expect(providerSearch?.isProviderExecuted).toBe(true);
    expect(providerSearch?.execute).toBeUndefined();

    // The dynamic definition is the final same-name entry, so no provider
    // executor survives in a forbidden mode and the local shadow is the only
    // callable path.
    expect(finalSearch?.type).not.toBe("provider");
    expect(finalSearch?.isProviderExecuted).not.toBe(true);
    const execute = finalSearch?.execute;
    expect(execute).toBeDefined();
    if (execute === undefined) throw new Error(`web_search shadow for ${mode} is not executable`);
    const result = await runtime.contextStorage.run(ctx, () =>
      execute({}, { toolCallId: `call-${mode}` }),
    );
    expect(result).toMatchObject({ performed: false, tool: "web_search", mode });
  });

  it("keeps provider-managed search for an authenticated web_chat turn", async () => {
    const { providerTools, finalTools } = await buildRuntimeToolSets(WEB_OWNER);
    const providerSearch = providerTools.web_search;
    const finalSearch = finalTools.web_search;

    expect(providerSearch?.type).toBe("provider");
    expect(providerSearch?.isProviderExecuted).toBe(true);
    expect(finalSearch?.type).toBe("provider");
    expect(finalSearch?.isProviderExecuted).toBe(true);
    expect(finalSearch?.execute).toBeUndefined();
  });
});
