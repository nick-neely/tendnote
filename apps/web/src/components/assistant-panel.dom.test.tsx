// @vitest-environment jsdom
import type { EveMessage } from "eve/react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * The two ways an Eve turn can lie to the composer.
 *
 * 1. A failed turn does not reject. `EveAgentStore.send()` catches its own
 *    network/stream error, parks it on `status: "error"`, announces it through
 *    `onError`, and then *resolves*. The composer clears optimistically on
 *    hand-off and only puts text back on a rejection, so unless the panel turns
 *    that swallowed failure back into one, a failed send takes the user's words
 *    with it.
 * 2. A tool part does not reliably reach a terminal state. A turn can end with a
 *    call parked in `input-available`, and its "Searching people…" shimmer would
 *    then claim forever that work is in progress.
 */

/**
 * Eve's store, reduced to the behavior that matters here: `send` resolves either
 * way, and a failure is announced only through `onError` - before the promise
 * settles, exactly as the real store orders it.
 */
const { eve } = vi.hoisted(() => {
  type Status = "error" | "ready" | "streaming" | "submitted";
  type Snapshot = {
    data: { messages: readonly EveMessage[] };
    error: Error | undefined;
    events: readonly unknown[];
    session: Record<string, unknown>;
    status: Status;
  };

  const initial: Snapshot = {
    data: { messages: [] },
    error: undefined,
    events: [],
    session: {},
    status: "ready",
  };

  const listeners = new Set<() => void>();
  const sent: string[] = [];
  let snapshot: Snapshot = initial;
  let onError: ((error: Error) => void) | undefined;
  let settleTurn: ((failure?: Error) => void) | null = null;

  function publish(next: Partial<Snapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    eve: {
      sent,
      getSnapshot: (): Snapshot => snapshot,
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      registerOnError: (handler?: (error: Error) => void): void => {
        onError = handler;
      },
      send: (input: { message: string }): Promise<void> => {
        sent.push(input.message);
        publish({ error: undefined, status: "submitted" });
        return new Promise<void>((resolve) => {
          settleTurn = (failure) => {
            settleTurn = null;
            if (failure) {
              onError?.(failure);
              publish({ error: failure, status: "error" });
            } else {
              publish({ error: undefined, status: "ready" });
            }
            resolve();
          };
        });
      },
      /** Settle the in-flight turn the way eve does: never by rejecting. */
      settle: (failure?: Error): void => {
        settleTurn?.(failure);
      },
      showTurn: (messages: readonly EveMessage[], status: Status): void => {
        publish({ data: { messages }, status });
      },
      reset: (): void => {
        sent.length = 0;
        settleTurn = null;
        snapshot = initial;
      },
    },
  };
});

vi.mock("eve/react", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEveAgent: (options?: { onError?: (error: Error) => void }) => {
      // The real hook re-registers its callbacks on every render.
      eve.registerOnError(options?.onError);
      const snapshot = useSyncExternalStore(eve.subscribe, eve.getSnapshot, eve.getSnapshot);
      return { ...snapshot, reset: () => {}, send: eve.send, stop: () => {} };
    },
  };
});

// A turn's result cards pull the whole server-action surface into the module
// graph. These tests are about the composer and the working lines, so the cards
// stand aside - their own suites cover them.
vi.mock("@/components/assistant-turn-unit", () => ({
  AssistantTurnUnitView: () => null,
  turnUnitKey: (messageId: string, unit: { type: string }) => `${messageId}:${unit.type}`,
}));
vi.mock("@/app/actions/asset-evidence", () => ({
  addAssetEvidenceAction: vi.fn(),
  addAssetEvidenceToNewAssetAction: vi.fn(),
  listAssetEvidenceDestinationsAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AssistantPanel } from "./assistant-panel";

// jsdom implements neither observer the transcript's stick-to-bottom uses.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  vi.stubGlobal("MutationObserver", ObserverStub);
  window.localStorage.clear();
  eve.reset();
});

function composer(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

/** Types a message into the composer and hands it off with Enter. */
async function sendMessage(text: string): Promise<void> {
  await userEvent.type(composer(), `${text}{Enter}`);
}

/** Settles the in-flight turn from outside React's own event flow. */
async function settleTurn(failure?: Error): Promise<void> {
  await act(async () => {
    eve.settle(failure);
  });
}

it("puts the message back when the turn fails, even though eve resolves the send", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  // Optimistic hand-off: the composer empties before the turn settles.
  expect(composer().value).toBe("");

  await settleTurn(new Error("stream closed"));

  await waitFor(() => expect(composer().value).toBe("Mara adopted a cat"));
  expect(screen.getByRole("alert").textContent).toContain("Eve is unavailable");
});

it("never overwrites something newer the user typed while the turn was failing", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  expect(composer().value).toBe("");

  // A failing turn can take many seconds; the next thought is already typed.
  await userEvent.type(composer(), "Actually it was two cats");
  await settleTurn(new Error("stream closed"));

  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect(composer().value).toBe("Actually it was two cats");
});

it("takes the next message after a failure instead of wedging on the error status", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  await settleTurn(new Error("stream closed"));
  await waitFor(() => expect(composer().value).toBe("Mara adopted a cat"));

  // `error` is the last turn's verdict, not a busy signal: a retry must go out.
  await userEvent.type(composer(), "{Enter}");

  await waitFor(() => expect(eve.sent).toEqual(["Mara adopted a cat", "Mara adopted a cat"]));
  expect(composer().value).toBe("");
});

it("keeps a message in the composer when a turn is genuinely still in flight", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  expect(composer().value).toBe("");

  await sendMessage("And she moved to Lisbon");

  await waitFor(() => expect(composer().value).toBe("And she moved to Lisbon"));
  expect(eve.sent).toEqual(["Mara adopted a cat"]);
});

/**
 * Eve leaves a submission it never accepted in the transcript, flagged only by
 * `metadata.status`. Rendered plain it is indistinguishable from one that landed.
 */
const failedSubmission: readonly EveMessage[] = [
  {
    id: "turn_0:user",
    role: "user",
    metadata: { status: "failed" },
    parts: [{ type: "text", text: "Mara adopted a cat", state: "done" }],
  },
];

it("says so quietly when a message in the transcript never reached Eve", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(failedSubmission, "ready");
  });

  expect(screen.getByText("Mara adopted a cat")).toBeDefined();
  expect(screen.getByText("Not sent")).toBeDefined();
});

it("leaves a delivered message unlabeled", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(
      [{ ...failedSubmission[0], metadata: { status: "submitted" } }] as readonly EveMessage[],
      "ready",
    );
  });

  expect(screen.queryByText("Not sent")).toBeNull();
});

/** A turn whose `search_people` call never reached a terminal state. */
const turnWithParkedSearch: readonly EveMessage[] = [
  {
    id: "turn_0:assistant",
    role: "assistant",
    parts: [
      { type: "text", text: "Jordan Rivera works at a bakery.", state: "done" },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "search_people",
        state: "input-available",
        input: { query: "Jordan" },
      },
    ],
  },
];

it("shows a working line only while the turn that owns it is running", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnWithParkedSearch, "streaming");
  });
  expect(screen.queryAllByText("Searching people…").length).toBeGreaterThan(0);

  // The turn settles with the call still parked - the shimmer goes with it.
  await act(async () => {
    eve.showTurn(turnWithParkedSearch, "ready");
  });

  expect(screen.queryAllByText("Searching people…")).toEqual([]);
  expect(screen.getByText("Jordan Rivera works at a bakery.")).toBeDefined();
});
