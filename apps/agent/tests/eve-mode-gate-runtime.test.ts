import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { webFetch } from "eve/tools/web_fetch";
import { defaultWebSearch } from "eve/tools/web_search";
import { describe, expect, it } from "vitest";
import gate from "../agent/tools/eve_mode_gate";
import webFetchTool from "../agent/tools/web_fetch";

type Principal = { principalType: string; attributes?: Record<string, string> };

type EveHarnessTools = {
  buildToolSetFromDefinitions(input: { tools: readonly unknown[] }): Record<string, EveTool>;
  buildToolSetWithProviderTools(input: {
    modelReference: { id: string };
    tools: Map<string, unknown>;
  }): Promise<Record<string, EveTool>>;
};

type EveContext = {
  set(key: unknown, value: unknown): unknown;
};

type EveContextStorage = {
  run<T>(context: EveContext, callback: () => Promise<T>): Promise<T>;
};

type EveTool = {
  readonly name?: string;
  readonly description?: string;
  readonly type?: string;
  readonly id?: string;
  readonly isProviderExecuted?: boolean;
  readonly execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

type EveToolDefinition = EveTool & {
  readonly name: string;
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
  stampDurableDynamicToolCallbacks(
    definition: object,
    callbacks: {
      execute: { callback: (closure: unknown, ...args: never[]) => unknown; closure: object };
    },
  ): void;
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
  frameworkWebFetch: EveToolDefinition;
}> {
  const [container, keys, lifecycle, dynamicTools, durableCallbacks, harnessTools] =
    await Promise.all([
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
      loadEveInternal<Pick<EveRuntime, "stampDurableDynamicToolCallbacks">>(
        "dist/src/tools/durable-callbacks.js",
      ),
      loadEveInternal<EveHarnessTools>("dist/src/harness/tools.js"),
    ]);

  return {
    runtime: { ...container, ...keys, ...lifecycle, ...dynamicTools, ...durableCallbacks },
    tools: harnessTools,
    webSearch: harnessWebSearchDefinition(),
    frameworkWebFetch: webFetch as unknown as EveToolDefinition,
  };
}

/**
 * `web_search` as the harness receives it. Eve's public export is the
 * `webSearch()` *configuration* (`{ kind, provider }`); its compiler turns that
 * into a harness tool carrying `handling.kind: "provider-tool"`, which is the
 * one property `buildToolSetWithProviderTools` branches on when it swaps in the
 * provider-executed search tool. Mirroring that here keeps the merge below the
 * real one without reaching into eve's compiler for a single object.
 */
function harnessWebSearchDefinition() {
  return {
    behavior: { availability: [], handling: { ...defaultWebSearch, kind: "provider-tool" } },
    description: "Search the web for real-time information.",
    inputSchema: null,
    name: "web_search",
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

/**
 * The gate's resolver, with each shadow's inline `execute` stamped the way eve's
 * build transform stamps it in a deployed bundle.
 *
 * Since 0.47 the runtime refuses a dynamic tool whose `execute` carries no
 * durable descriptor, so an untransformed resolver silently resolves to nothing
 * — which would make this test pass vacuously by asserting against an empty
 * dynamic set. Stamping here reproduces what production actually runs, and
 * leaves the gate's own source untouched.
 */
function runtimeResolver(runtime: EveRuntime): RuntimeResolver {
  const turnStarted = gate.events["turn.started"];
  if (turnStarted === undefined) throw new Error("the gate no longer resolves on turn.started");

  return {
    slug: "eve_mode_gate",
    eventNames: ["turn.started"],
    events: {
      "turn.started": async (event, ctx) => {
        const resolved = await turnStarted(event, ctx);
        if (resolved === null || resolved === undefined) return resolved;
        for (const entry of Object.values(resolved as Record<string, EveTool>)) {
          const execute = entry.execute;
          if (execute === undefined) continue;
          runtime.stampDurableDynamicToolCallbacks(entry, {
            execute: {
              callback: ((_closure: unknown, input: unknown, options: unknown) =>
                execute(input, options)) as never,
              closure: {},
            },
          });
        }
        return resolved;
      },
    } as RuntimeResolver["events"],
    sourceKind: "module",
    sourceId: "apps/agent/agent/tools/eve_mode_gate.ts",
    logicalPath: "tools/eve_mode_gate",
  };
}

async function buildRuntimeToolSets(current: Principal | null) {
  const { runtime, tools, webSearch, frameworkWebFetch } = await loadRuntime();
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
    resolvers: [runtimeResolver(runtime)],
    event: { type: "turn.started", data: { sequence: 0, turnId: "turn_0" } },
    messages: [],
  });

  // `web_fetch` is authored by Tendnote as a thin wrapper around Eve's
  // installed framework default. Keeping it in the static set makes this the
  // same framework assembly that web_chat receives before the dynamic gate
  // overlays a forbidden mode. The wrapper now has an executor of its own -
  // it calls the framework one and attaches a citation - so what matters here
  // is that it is an authored executor at all, which is what the gate has to
  // be able to shadow.
  expect(typeof webFetchTool.execute).toBe("function");
  expect(webFetchTool.inputSchema).toBe(webFetch.inputSchema);
  // As of eve 0.47 a tool's name comes from its `tools/<slug>.ts` path rather
  // than the definition object, so the authored wrapper is named here the way
  // the compiler would name `agent/tools/web_fetch.ts`.
  const authoredWebFetch = {
    ...frameworkWebFetch,
    ...webFetchTool,
    name: "web_fetch",
  };
  expect(authoredWebFetch.execute).toBe(webFetchTool.execute);
  const staticTools = new Map<string, unknown>([
    ["web_search", webSearch],
    ["web_fetch", authoredWebFetch],
  ]);
  const providerTools = await tools.buildToolSetWithProviderTools({
    modelReference: { id: "google/gemini-3.7-flash" },
    tools: staticTools,
  });
  const dynamicTools = tools.buildToolSetFromDefinitions({
    tools: runtime.buildDynamicTools(ctx),
  });

  // This is the merge in Eve 0.32's tool-loop: provider tools are injected from
  // the advertised static map first, then dynamic turn tools win by name.
  return { ctx, runtime, providerTools, finalTools: { ...providerTools, ...dynamicTools } };
}

type ToolSets = Awaited<ReturnType<typeof buildRuntimeToolSets>>;

/** Runs a tool's executor inside the same session context the gate resolved on. */
async function runShadow(
  sets: Pick<ToolSets, "ctx" | "runtime">,
  tool: EveTool | undefined,
  input: Record<string, unknown>,
  toolCallId: string,
): Promise<unknown> {
  const execute = tool?.execute;
  expect(execute).toBeDefined();
  if (execute === undefined) throw new Error(`${toolCallId} is not executable`);
  return sets.runtime.contextStorage.run(sets.ctx, () => execute(input, { toolCallId }));
}

/**
 * `web_search` in a forbidden mode. Asserting the *provider* set first proves
 * this exercised `buildToolSetWithProviderTools` rather than merely inspecting
 * the gate: the static framework definition really did become Eve's
 * provider-executed search tool before the dynamic overlay replaced it.
 */
async function expectWithheldSearch(sets: ToolSets, mode: string): Promise<void> {
  const providerSearch = sets.providerTools.web_search;
  expect(providerSearch?.type).toBe("provider");
  expect(providerSearch?.isProviderExecuted).toBe(true);
  expect(providerSearch?.execute).toBeUndefined();

  // The dynamic definition is the final same-name entry, so no provider
  // executor survives in a forbidden mode and the local shadow is the only
  // callable path.
  const finalSearch = sets.finalTools.web_search;
  expect(finalSearch?.type).not.toBe("provider");
  expect(finalSearch?.isProviderExecuted).not.toBe(true);
  const result = await runShadow(sets, finalSearch, {}, `call-${mode}`);
  expect(result).toMatchObject({ performed: false, tool: "web_search", mode });
}

/**
 * `web_fetch` in a forbidden mode. It is authored, so Eve keeps its real
 * framework executor in the static set; the dynamic same-name shadow must be the
 * only final entry, and executing it must never reach that executor.
 */
async function expectWithheldFetch(sets: ToolSets, mode: string): Promise<void> {
  const providerFetch = sets.providerTools.web_fetch;
  expect(providerFetch?.execute).toBeDefined();
  expect(providerFetch?.description).toContain("public HTTPS");
  expect(providerFetch?.description).toContain("untrusted external web content");

  const finalFetch = sets.finalTools.web_fetch;
  expect(finalFetch?.type).not.toBe("provider");
  expect(finalFetch?.execute).toBeDefined();
  expect(finalFetch?.execute).not.toBe(providerFetch?.execute);
  const result = await runShadow(sets, finalFetch, { url: "https://example.com" }, `fetch-${mode}`);
  expect(result).toMatchObject({ performed: false, tool: "web_fetch", mode });
}

describe("Eve mode gate at the 0.32 runtime tool merge", () => {
  it.each(FORBIDDEN_SESSIONS)(
    "shadows both network tools before a %s session can execute either",
    async (mode, principal) => {
      const sets = await buildRuntimeToolSets(principal);
      await expectWithheldSearch(sets, mode);
      await expectWithheldFetch(sets, mode);
    },
  );

  it("keeps provider-managed search for an authenticated web_chat turn", async () => {
    const { providerTools, finalTools } = await buildRuntimeToolSets(WEB_OWNER);
    const providerSearch = providerTools.web_search;
    const finalSearch = finalTools.web_search;

    expect(providerSearch?.type).toBe("provider");
    expect(providerSearch?.isProviderExecuted).toBe(true);
    expect(finalSearch?.type).toBe("provider");
    expect(finalSearch?.isProviderExecuted).toBe(true);
    expect(finalSearch?.execute).toBeUndefined();

    const providerFetch = providerTools.web_fetch;
    const finalFetch = finalTools.web_fetch;
    expect(providerFetch?.type).not.toBe("provider");
    expect(providerFetch?.execute).toBeDefined();
    expect(providerFetch?.description).toContain("public HTTPS");
    expect(providerFetch?.description).toContain("untrusted external web content");
    expect(finalFetch?.type).not.toBe("provider");
    expect(finalFetch?.execute).toBe(providerFetch?.execute);
  });
});
