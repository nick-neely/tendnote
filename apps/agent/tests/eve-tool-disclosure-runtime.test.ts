import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { EVE_SKILL_NAMES, toolsUnavailableInMode } from "../agent/lib/eve-modes";
import { TOOL_FAMILY_NAMES, toolFamilyMembers } from "../agent/lib/tool-disclosure";
import gate from "../agent/tools/eve_mode_gate";
import disclosure from "../agent/tools/eve_tool_disclosure";

/**
 * Progressive disclosure and the mode gate dispatched through eve's own dynamic
 * tool lifecycle, the way a turn runs them: the gate on `turn.started`, then
 * disclosure on `step.started`, then eve's merged dynamic set replayed from its
 * durable metadata. `eve-tool-disclosure.test.ts` covers the rules; this covers
 * the wiring.
 */

type Principal = { principalType: string; attributes?: Record<string, string> };

type ResolvedEntry = { readonly execute?: (input: unknown, options: unknown) => unknown };

type ReplayedTool = {
  readonly name: string;
  readonly execute: (input: unknown, options: unknown) => Promise<unknown>;
};

type EveContext = { set(key: unknown, value: unknown): unknown };

type RuntimeEvent =
  | { type: "turn.started"; data: { sequence: number; turnId: string } }
  | { type: "step.started"; data: { sequence: number; turnId: string; stepIndex: number } };

type Handler = (event: unknown, ctx: unknown) => unknown;

type RuntimeResolver = {
  slug: string;
  eventNames: readonly string[];
  events: Record<string, Handler>;
  sourceKind: "module";
  sourceId: string;
  logicalPath: string;
};

type EveRuntime = {
  ContextContainer: new () => EveContext;
  AuthKey: unknown;
  InitiatorAuthKey: unknown;
  SessionIdKey: unknown;
  SessionKey: unknown;
  contextStorage: { run<T>(context: EveContext, callback: () => Promise<T>): Promise<T> };
  dispatchDynamicToolEvent(input: {
    ctx: EveContext;
    resolvers: readonly RuntimeResolver[];
    event: RuntimeEvent;
    messages: readonly unknown[];
  }): Promise<void>;
  buildDynamicTools(ctx: EveContext): readonly ReplayedTool[];
  stampDurableDynamicToolCallbacks(
    definition: object,
    callbacks: {
      execute: { callback: (closure: never, ...args: never[]) => unknown; closure: object };
    },
  ): void;
};

const eveRoot = dirname(createRequire(import.meta.url).resolve("eve/package.json"));

async function loadEveInternal<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(join(eveRoot, relativePath)).href)) as T;
}

async function loadRuntime(): Promise<EveRuntime> {
  const modules = await Promise.all([
    loadEveInternal<object>("dist/src/context/container.js"),
    loadEveInternal<object>("dist/src/context/keys.js"),
    loadEveInternal<object>("dist/src/context/dynamic-tool-lifecycle.js"),
    loadEveInternal<object>("dist/src/context/build-dynamic-tools.js"),
    loadEveInternal<object>("dist/src/tools/durable-callbacks.js"),
  ]);
  return Object.assign({}, ...modules) as EveRuntime;
}

/**
 * The one callback eve's build transform hoists out of `lib/withheld-tool.ts`:
 * it returns the `result` its closure captured. Every withheld name, from either
 * resolver, is stamped with this same function, as in a deployed bundle.
 */
function withheldToolCallback(closure: { result: unknown }): unknown {
  return closure.result;
}

function stamped(
  runtime: EveRuntime,
  slug: string,
  eventName: RuntimeEvent["type"],
  handler: Handler | undefined,
): RuntimeResolver {
  if (handler === undefined) throw new Error(`${slug} no longer resolves on ${eventName}`);
  return {
    slug,
    eventNames: [eventName],
    events: {
      [eventName]: async (event, ctx) => {
        const resolved = (await handler(event, ctx)) as Record<string, ResolvedEntry> | null;
        if (resolved === null || resolved === undefined) return resolved;
        for (const entry of Object.values(resolved)) {
          const result = await entry.execute?.({}, {});
          runtime.stampDurableDynamicToolCallbacks(entry, {
            execute: { callback: withheldToolCallback as never, closure: { result } },
          });
        }
        return resolved;
      },
    },
    sourceKind: "module",
    sourceId: `apps/agent/agent/tools/${slug}.ts`,
    logicalPath: `tools/${slug}`,
  };
}

async function resolveStep(
  runtime: EveRuntime,
  current: Principal | null,
  messages: readonly unknown[],
) {
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
    resolvers: [
      stamped(runtime, "eve_mode_gate", "turn.started", gate.events["turn.started"] as Handler),
    ],
    event: { type: "turn.started", data: { sequence: 0, turnId: "turn_0" } },
    messages,
  });
  await runtime.dispatchDynamicToolEvent({
    ctx,
    resolvers: [
      stamped(
        runtime,
        "eve_tool_disclosure",
        "step.started",
        disclosure.events["step.started"] as Handler,
      ),
    ],
    event: { type: "step.started", data: { sequence: 1, turnId: "turn_0", stepIndex: 0 } },
    messages,
  });

  const tools = runtime.buildDynamicTools(ctx);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const run = (name: string) =>
    runtime.contextStorage.run(ctx, async () =>
      byName.get(name)?.execute({}, { toolCallId: `call-${name}` }),
    );
  return { names: tools.map((tool) => tool.name), byName, run };
}

const WEB_OWNER: Principal = { principalType: "user", attributes: { channel: "eve" } };
const SCHEDULE: Principal = { principalType: "runtime" };
const FAMILY_TOOLS = TOOL_FAMILY_NAMES.flatMap((family) => toolFamilyMembers(family));
const EVERY_SKILL_LOADED = EVE_SKILL_NAMES.map((skill) => ({
  role: "assistant",
  content: [
    { type: "tool-call", toolCallId: `call-${skill}`, toolName: "load_skill", input: { skill } },
  ],
}));

describe("progressive disclosure at eve's dynamic tool lifecycle", () => {
  it("withholds every family schema from a new interactive conversation, and nothing else", async () => {
    const runtime = await loadRuntime();
    const step = await resolveStep(runtime, WEB_OWNER, []);

    expect([...step.names].sort()).toEqual([...FAMILY_TOOLS].sort());
    expect(await step.run("save_draft_to_gmail")).toMatchObject({
      performed: false,
      skill: "drafting",
    });
  });

  it("leaves every authored executor in place once every skill is loaded", async () => {
    const runtime = await loadRuntime();
    const step = await resolveStep(runtime, WEB_OWNER, EVERY_SKILL_LOADED);

    expect(step.names).toEqual([]);
  });

  it("keeps a scheduled run's forbidden family tools gated even with every skill loaded", async () => {
    const runtime = await loadRuntime();
    const step = await resolveStep(runtime, SCHEDULE, EVERY_SKILL_LOADED);

    // Exactly the gate's set, each once: disclosure added nothing and removed nothing.
    expect([...step.names].sort()).toEqual(
      [...toolsUnavailableInMode("scheduled_workflow")].sort(),
    );
    expect(await step.run("add_gift_idea")).toMatchObject({
      performed: false,
      tool: "add_gift_idea",
      mode: "scheduled_workflow",
    });
    // A read the schedule may use is authored, not withheld by either resolver.
    expect(step.byName.has("get_gift_plan")).toBe(false);
  });

  it("gives each session its own answer when both resolvers bind one name in one process", async () => {
    // eve's callback registry is process-wide and keyed by tool name. Resolve a
    // scheduled run after an interactive conversation, then call the interactive
    // conversation's `add_gift_idea`: it must still report its own reason.
    const runtime = await loadRuntime();
    const interactive = await resolveStep(runtime, WEB_OWNER, []);
    const scheduled = await resolveStep(runtime, SCHEDULE, []);

    expect(await interactive.run("add_gift_idea")).toMatchObject({ skill: "household-and-gifts" });
    expect(await scheduled.run("add_gift_idea")).toMatchObject({ mode: "scheduled_workflow" });
  });
});
