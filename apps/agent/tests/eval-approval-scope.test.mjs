import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "eve/client";
import { afterEach, expect, it, vi } from "vitest";
import actionMutation from "../evals/behavior/general-action-explicit-mutation.eval";

// Exercise the installed Eve driver's real per-response assertion scopes.
const require = createRequire(import.meta.url);
const internal = (path) =>
  import(pathToFileURL(resolve(dirname(require.resolve("eve")), path)).href);
const { EvalSessionManager } = await internal("evals/session.js");
const { AssertionCollector } = await internal("evals/assertions/collector.js");
const { createEvalContext } = await internal("evals/context.js");
afterEach(() => vi.unstubAllGlobals());

const event = (type, id, data = {}) => ({ type, meta: { id, at: "2026-09-22T00:00:00Z" }, data });
const waiting = (id) => event("session.waiting", id, { wait: "next-user-message" });
function batches(title) {
  const create = {
    callId: "create",
    kind: "tool-call",
    toolName: "create_general_action",
    input: { title },
  };
  const update = {
    callId: "update",
    kind: "tool-call",
    toolName: "update_general_action_status",
    input: { action: "complete" },
  };
  return [
    [
      event("turn.started", "start-0", { turnId: "turn_0", sequence: 0 }),
      event("actions.requested", "create-request", { actions: [create] }),
      event("input.requested", "approval", {
        requests: [
          {
            requestId: "approval-1",
            kind: "tool-approval",
            action: create,
            options: [{ id: "approve", label: "Approve" }],
          },
        ],
      }),
      waiting("waiting-0"),
    ],
    [
      event("turn.started", "start-1", { turnId: "turn_1", sequence: 1 }),
      event("action.result", "create-result", {
        status: "completed",
        result: {
          callId: "create",
          kind: "tool-result",
          toolName: "create_general_action",
          output: { action: { id: "action-1", title } },
        },
      }),
      event("message.completed", "reply-1", { message: "Added the action.", finishReason: "stop" }),
      waiting("waiting-1"),
    ],
    [
      event("turn.started", "start-2", { turnId: "turn_2", sequence: 2 }),
      event("actions.requested", "update-request", { actions: [update] }),
      event("action.result", "update-result", {
        status: "completed",
        result: {
          callId: "update",
          kind: "tool-result",
          toolName: "update_general_action_status",
          output: { updated: true },
        },
      }),
      event("message.completed", "reply-2", {
        message: "Marked the action complete.",
        finishReason: "stop",
      }),
      waiting("waiting-2"),
    ],
  ];
}

it.each(["Test the smoke alarm batteries", "An unrelated action"])(
  "grades the actual pre-approval input: %s",
  async (title) => {
    const pending = batches(title);
    const events = [];
    let approvals = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        if (options.method === "POST") {
          const body = JSON.parse(options.body);
          if (body.inputResponses) {
            expect(body.inputResponses).toEqual([{ requestId: "approval-1", optionId: "approve" }]);
            approvals += 1;
          }
          events.push(...pending.shift());
          return Response.json({ sessionId: "fixture" });
        }
        const cursor = Number(new URL(url).searchParams.get("startIndex") ?? 0);
        return new Response(
          `${events
            .slice(cursor)
            .map((e) => JSON.stringify(e))
            .join("\n")}\n`,
        );
      }),
    );
    const collector = new AssertionCollector();
    const manager = new EvalSessionManager({
      client: new Client({ host: "http://fixture.invalid" }),
      collector,
    });
    const { context } = createEvalContext({
      manager,
      collector,
      target: {},
      signal: new AbortController().signal,
      judge: undefined,
      log: () => {},
    });
    await actionMutation.test(context);
    const snapshot = manager.snapshots()[0];
    const assertions = await collector.finalize({
      ...snapshot,
      status: "waiting",
      output: manager.primary.lastTurn.message,
    });
    expect(approvals).toBe(1);
    expect(assertions.filter((a) => !a.passed).map((a) => a.name)).toEqual(
      title.includes("smoke alarm") ? [] : ["calledTool(create_general_action)"],
    );
  },
);
