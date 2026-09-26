import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client, ClientError } from "eve/client";
import { afterEach, expect, it, vi } from "vitest";
import { sendReplayTurn } from "../evals/cost-replay/session";

const require = createRequire(import.meta.url);
const base = dirname(require.resolve("eve"));
const { EvalSessionManager } = await import(pathToFileURL(resolve(base, "evals/session.js")).href);
const { createSessionStreamResponse } = await import(
  pathToFileURL(resolve(base, "eve-channel/request.js")).href
);
afterEach(() => vi.unstubAllGlobals());

it("reads an already-created session after a transient stream-open failure without resending", async () => {
  let posts = 0;
  let reads = 0;
  const events = [
    {
      type: "message.completed",
      meta: { id: "reply", at: "2026-09-21T00:00:00Z" },
      data: { turnId: "turn_1", message: "Recall complete", finishReason: "stop" },
    },
    {
      type: "session.waiting",
      meta: { id: "boundary", at: "2026-09-21T00:00:00Z" },
      data: { wait: "next-user-message" },
    },
  ];
  const persisted = [];
  const transport = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST") {
      posts++;
      persisted.push(
        ...events.map((event) => ({
          ...event,
          meta: { ...event.meta, id: `${event.meta.id}-${posts}` },
        })),
      );
      return Response.json({ sessionId: "existing-session" });
    }
    return createSessionStreamResponse(request, {
      id: "existing-session",
      getEventStream: async () => {
        if (++reads <= 12) throw new Error("Transient stream storage unavailable");
        return new ReadableStream({
          start(controller) {
            for (const event of persisted.slice(
              Number(new URL(request.url).searchParams.get("startIndex") ?? 0),
            ))
              controller.enqueue(event);
            controller.close();
          },
        });
      },
    });
  };
  vi.stubGlobal("fetch", transport);
  const manager = new EvalSessionManager({
    client: new Client({ host: "http://127.0.0.1:9999" }),
  });
  const session = manager.newSession();
  const recovered = await sendReplayTurn(
    session,
    "Recall existing context",
    (id) => manager.watchTurn(id, { startIndex: 0 }),
    {
      streamReconnectPolicy: {
        streamOpenReconnectPolicy: { baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 12 },
      },
    },
  );
  expect(recovered.turn.message).toBe("Recall complete");
  expect(posts).toBe(1);
  expect(reads).toBe(13);
  const next = await sendReplayTurn(recovered.session, "Next turn", (id) =>
    manager.watchTurn(id, { startIndex: 0 }),
  );
  expect(next.turn.events.at(-1).meta.id).toBe("boundary-2");
  expect(posts).toBe(2);
});

// Ambiguous writes and partly consumed turns must fall back to the checkpoint.
it.each([
  { sessionId: undefined, streamIndex: 0, status: 404 },
  { sessionId: "existing", streamIndex: 1, status: 404 },
  { sessionId: "existing", streamIndex: 0, status: 500 },
])("does not recover by resending an ambiguous request: %j", async (state) => {
  const error = new ClientError(state.status, "Session not found.");
  const session = {
    sessionId: state.sessionId,
    state,
    events: [],
    send: vi.fn().mockRejectedValue(error),
  };
  const watch = vi.fn();
  await expect(sendReplayTurn(session, "Mutation", watch)).rejects.toBe(error);
  expect(session.send).toHaveBeenCalledTimes(1);
  expect(watch).not.toHaveBeenCalled();
});
