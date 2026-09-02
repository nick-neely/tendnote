import { describe, expect, it } from "vitest";
import {
  EMPTY_SEND_QUEUE,
  nextQueuedMessage,
  queueToDraft,
  type SendQueueAction,
  type SendQueueState,
  sendQueueReducer,
} from "./send-queue";

/**
 * A queue is a promise that the words will go out. These pin the four ways it
 * could break that promise: sending two at once, losing the order, retrying
 * forever against a session that is refusing work, and never resuming after it
 * stopped.
 */

function run(actions: readonly SendQueueAction[]): SendQueueState {
  return actions.reduce(sendQueueReducer, EMPTY_SEND_QUEUE);
}

const enqueue = (id: string, text: string): SendQueueAction => ({ id, text, type: "enqueue" });

describe("sendQueueReducer", () => {
  it("keeps the order things were said in", () => {
    const state = run([enqueue("a", "First"), enqueue("b", "Second"), enqueue("c", "Third")]);

    expect(state.items.map((item) => item.text)).toEqual(["First", "Second", "Third"]);
    expect(nextQueuedMessage(state)?.text).toBe("First");
  });

  it("refuses to queue nothing", () => {
    const state = run([enqueue("a", "   ")]);

    expect(state.items).toEqual([]);
  });

  it("trims what it stores, so the queued text is the text that gets sent", () => {
    const state = run([enqueue("a", "  Mara adopted a cat\n")]);

    expect(state.items[0]?.text).toBe("Mara adopted a cat");
  });

  it("hands over one message at a time", () => {
    const state = run([enqueue("a", "First"), enqueue("b", "Second"), { id: "a", type: "start" }]);

    // "First" has left the queue - it is in the transcript now - and "Second"
    // waits until the hand-off settles rather than stacking on top of it.
    expect(state.items.map((item) => item.id)).toEqual(["b"]);
    expect(nextQueuedMessage(state)).toBeNull();

    const settled = sendQueueReducer(state, { id: "a", type: "settle" });
    expect(nextQueuedMessage(settled)?.text).toBe("Second");
  });

  it("stops draining after a failure but keeps everything still queued", () => {
    const state = run([
      enqueue("a", "First"),
      enqueue("b", "Second"),
      { id: "a", type: "start" },
      { type: "pause" },
      { id: "a", type: "settle" },
    ]);

    expect(state.items.map((item) => item.text)).toEqual(["Second"]);
    expect(nextQueuedMessage(state)).toBeNull();
  });

  it("resumes when the user says something new", () => {
    const paused = run([enqueue("a", "First"), { type: "pause" }]);
    const resumed = sendQueueReducer(paused, enqueue("b", "Second"));

    expect(resumed.paused).toBe(false);
    expect(nextQueuedMessage(resumed)?.text).toBe("First");
  });

  it("lets an item be taken out of the line", () => {
    const state = run([enqueue("a", "First"), enqueue("b", "Second"), { id: "a", type: "remove" }]);

    expect(state.items.map((item) => item.text)).toEqual(["Second"]);
  });

  it("returns the same state when nothing changed, so an effect does not re-run", () => {
    const state = run([enqueue("a", "First")]);

    expect(sendQueueReducer(state, { id: "missing", type: "remove" })).toBe(state);
    expect(sendQueueReducer(state, { id: "missing", type: "settle" })).toBe(state);
  });
});

/**
 * What a torn-down queue leaves behind for the draft it becomes. This is the
 * merge rule only - `use-send-queue.ts` is what actually reads and writes the
 * device-local draft on unmount.
 */
describe("queueToDraft", () => {
  it("leaves an existing draft alone when the queue is empty", () => {
    expect(queueToDraft("Already typed this", [])).toBe("Already typed this");
    expect(queueToDraft(null, [])).toBe("");
  });

  it("becomes the joined items when there was no draft", () => {
    expect(queueToDraft(null, [{ text: "First" }, { text: "Second" }])).toBe("First\n\nSecond");
    expect(queueToDraft("", [{ text: "First" }, { text: "Second" }])).toBe("First\n\nSecond");
  });

  it("appends below an existing draft rather than replacing it", () => {
    expect(queueToDraft("Something typed before any of this", [{ text: "Queued thought" }])).toBe(
      "Something typed before any of this\n\nQueued thought",
    );
  });

  it("drops an item that is already the draft instead of duplicating it", () => {
    expect(queueToDraft("Same words", [{ text: "Same words" }])).toBe("Same words");
    expect(queueToDraft("Same words", [{ text: "Same words" }, { text: "New one" }])).toBe(
      "Same words\n\nNew one",
    );
  });
});
