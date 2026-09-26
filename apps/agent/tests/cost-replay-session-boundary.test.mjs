import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "eve/client";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { EvalSessionManager } = await import(
  pathToFileURL(resolve(dirname(require.resolve("eve")), "evals/session.js")).href
);
afterEach(() => vi.unstubAllGlobals());

const event = (type, id, data = {}) => ({ type, meta: { id, at: "2026-09-20T00:00:00Z" }, data });
function turnEvents(sequence, reply) {
  const turnId = `turn_${sequence}`;
  return [
    event("turn.started", `start-${sequence}`, { turnId, sequence }),
    event("message.appended", `delta-${sequence}`, { turnId, messageDelta: reply }),
    event("message.completed", `reply-${sequence}`, {
      turnId,
      message: reply,
      finishReason: "stop",
    }),
    event("session.waiting", `waiting-${sequence}`, { wait: "next-user-message" }),
  ];
}
function fixture(batches, omitDelta = true) {
  const persisted = [];
  const posts = [];
  const cursors = [];
  const cancellations = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (String(url).endsWith("/cancel")) {
        cancellations.push(JSON.parse(options.body));
        return Response.json({ ok: true, sessionId: "fixture", status: "accepted" });
      }
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body));
        persisted.push(...batches[posts.length - 1]);
        return Response.json({ sessionId: "fixture" });
      }
      const cursor = Number(new URL(url).searchParams.get("startIndex") ?? 0);
      cursors.push(cursor);
      // Reproduce the observed delivery gap: one persisted delta was absent from
      // the first live read. The next durable read includes the old boundary.
      const events = persisted
        .slice(cursor)
        .filter((e) => !(omitDelta && cursors.length === 1 && e.meta.id === "delta-1"));
      return new Response(`${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    }),
  );
  const client = new Client({ host: "http://fixture.invalid" });
  const session = new EvalSessionManager({ client }).newSession();
  return { client, session, posts, cursors, cancellations };
}

it.each([false, true])(
  "sequential sends reach their own result after a delivery gap: %s",
  async (gap) => {
    const { session, posts, cursors } = fixture(
      [turnEvents(1, "Recall only"), turnEvents(2, "Captured once"), turnEvents(3, "Next recall")],
      gap,
    );
    expect((await session.send("Recall")).message).toBe("Recall only");
    const turn = await session.send("Capture this private note");
    expect(turn.message).toBe("Captured once");
    expect(turn.events.some((e) => e.meta.id === "waiting-1")).toBe(false);
    expect((await session.send("Recall again")).message).toBe("Next recall");
    expect(posts.map((p) => p.message)).toEqual([
      "Recall",
      "Capture this private note",
      "Recall again",
    ]);
    expect(cursors).toEqual([0, gap ? 3 : 4, 8]);
  },
);

it("preserves a new approval pause without requiring a turn.started event", async () => {
  const request = {
    requestId: "approval-1",
    action: { callId: "call-1", toolName: "capture", input: {} },
    kind: "approval",
    options: [{ id: "approve", label: "Approve" }],
  };
  const { session, posts } = fixture([
    turnEvents(1, "Recall only"),
    [
      event("input.requested", "approval-event", { requests: [request] }),
      event("session.waiting", "approval-wait", { wait: "input" }),
    ],
    turnEvents(2, "Approved result"),
  ]);
  await session.send("Recall");
  const turn = await session.send("An action needing approval");
  expect(turn.inputRequests).toEqual([request]);
  expect(turn.status).toBe("waiting");
  expect((await session.respond([{ requestId: "approval-1", optionId: "approve" }])).message).toBe(
    "Approved result",
  );
  expect(posts).toHaveLength(3);
  expect(posts[2].inputResponses).toEqual([{ requestId: "approval-1", optionId: "approve" }]);
});

it("cancels the current turn after skipping a stale boundary", async () => {
  const { client, posts, cancellations } = fixture([
    turnEvents(1, "Recall"),
    turnEvents(2, "Capture"),
  ]);
  const { session, response } = await client.sessions.create({ message: "Recall" });
  await response.result();
  const next = await session.send("Capture");
  const iterator = next[Symbol.asyncIterator]();
  expect((await iterator.next()).value.data.turnId).toBe("turn_2");
  expect(await next.cancel()).toEqual({ sessionId: "fixture", status: "accepted" });
  await iterator.return();
  expect(cancellations).toEqual([{ turnId: "turn_2" }]);
  expect(posts).toHaveLength(2);
});
