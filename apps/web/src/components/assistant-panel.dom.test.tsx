// @vitest-environment jsdom
import type { EveMessage } from "eve/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AssistantTurnCardUnit } from "@/lib/eve/message-views";
import { loadLocalComposerDraft } from "@/lib/local-composer-draft";
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
  type Status = "error" | "ready" | "resuming" | "streaming" | "submitted";
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
  const responded: unknown[][] = [];
  const resumed: unknown[] = [];
  const mounted: { initialEvents?: unknown; initialSession?: unknown; resume?: boolean }[] = [];
  /** What the panel's own pre-read of a reopened thread's stream finds. */
  let prefix: { events: readonly { type: string }[] } | { failure: Error } = { events: [] };
  let snapshot: Snapshot = initial;
  let onError: ((error: Error) => void) | undefined;
  let onSessionChange: ((session: { sessionId: string } | undefined) => void) | undefined;
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
      responded,
      getSnapshot: (): Snapshot => snapshot,
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      resumed,
      mounted,
      /** The events the reopened thread's stream hands back to the pre-read. */
      holds: (events: readonly { type: string }[]): void => {
        prefix = { events };
      },
      /** The pre-read's stream open is refused (the mount's opaque 404, an outage). */
      refuses: (failure: Error): void => {
        prefix = { failure };
      },
      readPrefix: (): readonly { type: string }[] => {
        if ("failure" in prefix) throw prefix.failure;
        return prefix.events;
      },
      registerCallbacks: (options?: {
        initialEvents?: unknown;
        initialSession?: unknown;
        onError?: (error: Error) => void;
        onSessionChange?: (session: { sessionId: string } | undefined) => void;
        resume?: boolean;
      }): void => {
        onError = options?.onError;
        onSessionChange = options?.onSessionChange;
        if (mounted.length === 0) {
          mounted.push({
            initialEvents: options?.initialEvents,
            initialSession: options?.initialSession,
            resume: options?.resume,
          });
        }
        if (options?.resume && !resumed.includes(options.initialSession)) {
          resumed.push(options.initialSession);
        }
      },
      /** The server has minted (or reattached to) a session id. */
      nameSession: (sessionId: string): void => {
        publish({ session: { sessionId } });
        onSessionChange?.({ sessionId });
      },
      /** The failure eve reports for a follow-up to an expired session. */
      failWith: (error: Error): void => {
        onError?.(error);
        publish({ error, status: "error" });
      },
      setStatus: (status: Status): void => {
        publish({ status });
      },
      /** eve's Stop: it settles the turn in flight without failing it. */
      cancel: (): Promise<void> => {
        settleTurn?.();
        return Promise.resolve();
      },
      send: (message: string, _options?: { clientContext?: unknown }): Promise<void> => {
        sent.push(message);
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
      /**
       * Answers a parked HITL request. eve accepts one only while nothing is in
       * flight - a parked turn leaves the session idle - so this mirrors `send`
       * only in recording the call, not in taking the session.
       */
      respond: (responses: readonly unknown[]): Promise<void> => {
        responded.push([...responses]);
        return Promise.resolve();
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
        responded.length = 0;
        resumed.length = 0;
        mounted.length = 0;
        prefix = { events: [] };
        settleTurn = null;
        snapshot = initial;
      },
    },
  };
});

/**
 * The panel reads a reopened thread's durable stream itself, before any session
 * exists, so it can tell a thread with a turn still running from one that is
 * simply finished (`use-assistant-session.ts`). Only the shape matters here: one
 * bounded pass that yields events or throws.
 */
vi.mock("eve/client", () => ({
  Client: class {
    sessions = {
      attach: () => ({
        stream: async function* () {
          for (const event of eve.readPrefix()) {
            yield event;
          }
        },
      }),
    };
  },
}));

vi.mock("eve/react", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEveAgent: (options?: {
      initialEvents?: unknown;
      initialSession?: unknown;
      onError?: (error: Error) => void;
      onSessionChange?: (session: { sessionId: string } | undefined) => void;
      resume?: boolean;
    }) => {
      // The real hook re-registers its callbacks on every render, and reads
      // `initialEvents` / `initialSession` / `resume` exactly once when it builds
      // its store.
      eve.registerCallbacks(options);
      const snapshot = useSyncExternalStore(eve.subscribe, eve.getSnapshot, eve.getSnapshot);
      return {
        ...snapshot,
        cancel: eve.cancel,
        reset: () => {},
        respond: eve.respond,
        send: eve.send,
        stop: () => {},
      };
    },
  };
});

// A turn's result cards pull the whole server-action surface into the module
// graph. These tests are about the composer, the working lines, and the wiring that
// reaches the cards, so the cards stand aside - their own suites cover them. The one
// thing the stand-in keeps is the approval card's lifeline: an approval resumes the
// live turn through the panel's own session, and only the panel can hand that down
// (chat-approval-card.dom.test.tsx covers the card itself). The keys the panel puts
// on these units are the real `turnUnitKey` — it is plain TypeScript over the unit
// union, so there is nothing to stand aside from.
vi.mock("@/components/assistant-turn-unit", async () => {
  const { useAssistantRespond } = await import("@/components/assistant-respond-context");
  return {
    AssistantTurnUnitView: ({ unit }: { unit: AssistantTurnCardUnit }) => {
      const { ready, respond } = useAssistantRespond();
      if (unit.type !== "request") {
        return null;
      }
      return (
        <button
          disabled={!ready}
          onClick={() => void respond([{ requestId: unit.request.requestId, optionId: "approve" }])}
          type="button"
        >
          {unit.request.toolName}
        </button>
      );
    },
  };
});
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

/**
 * Opens a reopened thread and waits out the panel's pre-read of its stream. Until
 * that read settles the panel holds turn-shaped geometry rather than a session,
 * because `useEveAgent` reads its configuration once and the read is what decides
 * what to tell it.
 */
async function openThread(element: React.ReactElement): Promise<void> {
  render(element);
  await waitFor(() => expect(eve.mounted.length).toBe(1));
}

it("puts the message back when the turn fails, even though eve resolves the send", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  // Optimistic hand-off: the composer empties before the turn settles.
  expect(composer().value).toBe("");

  await settleTurn(new Error("stream closed"));

  await waitFor(() => expect(composer().value).toBe("Mara adopted a cat"));
  expect(screen.getByRole("alert").textContent).toContain("The assistant is unavailable");
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

/**
 * Eve takes one turn at a time. The old answer was to refuse the second message
 * and bounce it back into the composer; now it waits in a visible queue and goes
 * out on its own when the turn settles.
 */
it("queues a message typed mid-turn instead of refusing it", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  expect(composer().value).toBe("");

  await sendMessage("And she moved to Lisbon");

  // The composer is empty because the words are somewhere the user can see them.
  await waitFor(() => expect(screen.getByText("And she moved to Lisbon")).toBeDefined());
  expect(composer().value).toBe("");
  expect(screen.getByText(/1 queued message/)).toBeDefined();
  expect(eve.sent).toEqual(["Mara adopted a cat"]);
});

it("sends the queued message on its own once the turn settles", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  await sendMessage("And she moved to Lisbon");
  await settleTurn();

  await waitFor(() => expect(eve.sent).toEqual(["Mara adopted a cat", "And she moved to Lisbon"]));
  expect(screen.queryByText(/queued message/)).toBeNull();
});

it("drains the queue one message at a time, in the order they were typed", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("First");
  await sendMessage("Second");
  await sendMessage("Third");
  expect(eve.sent).toEqual(["First"]);

  await settleTurn();
  await waitFor(() => expect(eve.sent).toEqual(["First", "Second"]));

  await settleTurn();
  await waitFor(() => expect(eve.sent).toEqual(["First", "Second", "Third"]));
});

/**
 * `/assistant` remounts the panel with a fresh `key` on every thread switch,
 * which discards this component's local state - including whatever the queue
 * was still holding. The queue's own contract says a message held invisibly is
 * a message the user believes they sent, so it has to land somewhere durable
 * before the remount, and the composer's own draft mechanism is already that
 * somewhere.
 */
it("hands still-queued messages to the draft store when the panel unmounts", async () => {
  const view = render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  await sendMessage("And she moved to Lisbon");
  await waitFor(() => expect(screen.getByText("And she moved to Lisbon")).toBeDefined());

  view.unmount();

  expect(loadLocalComposerDraft(window.localStorage, "owner-1", "eve")).toEqual({
    restored: true,
    value: "And she moved to Lisbon",
  });
});

/**
 * A message still being typed - never submitted, so never queued - is already
 * mirrored to the draft store on every keystroke by `AssistantDraftPersistence`.
 * That unsent thought is not this queue's to overwrite, so it lands above the
 * queued items rather than being replaced by them.
 */
it("appends queued messages below an unsent draft instead of clobbering it", async () => {
  const view = render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  await sendMessage("And she moved to Lisbon");
  await waitFor(() => expect(screen.getByText("And she moved to Lisbon")).toBeDefined());
  await userEvent.type(composer(), "Something else I'm about to say");
  await waitFor(() =>
    expect(loadLocalComposerDraft(window.localStorage, "owner-1", "eve").value).toBe(
      "Something else I'm about to say",
    ),
  );

  view.unmount();

  expect(loadLocalComposerDraft(window.localStorage, "owner-1", "eve").value).toBe(
    "Something else I'm about to say\n\nAnd she moved to Lisbon",
  );
});

it("takes a queued message back out when it is removed", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  await sendMessage("Never mind");

  await userEvent.click(screen.getByRole("button", { name: "Remove from the queue" }));
  await settleTurn();

  await waitFor(() => expect(screen.queryByText(/queued message/)).toBeNull());
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

/**
 * A turn eve parked on the owner: `capture_memory` is held at `approval-requested`
 * with the policy's prompt on the part, and the stream has ended (`ready`) because a
 * parked turn is durably waiting on a person rather than working.
 */
const turnAwaitingApproval: readonly EveMessage[] = [
  {
    id: "turn_0:assistant",
    role: "assistant",
    parts: [
      { type: "text", text: "One thing before I save that.", state: "done" },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "capture_memory",
        state: "approval-requested",
        approval: { id: "req-1" },
        input: { content: "Allergic to shellfish.", personId: "person-1" },
        toolMetadata: {
          eve: {
            kind: "tool-call",
            name: "capture_memory",
            inputRequest: {
              kind: "tool-approval",
              requestId: "req-1",
              // eve authors this itself; the substance is the frozen input above.
              prompt: "Approve tool call: capture_memory",
              display: "confirmation",
              allowFreeform: false,
              options: [
                { id: "approve", label: "Approve" },
                { id: "cancel", label: "Cancel" },
              ],
            },
          },
        },
      },
    ],
  },
];

it("hands the live session down so a parked approval can answer its own turn", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnAwaitingApproval, "ready");
  });

  // The card is reachable at all, which is the projection; and the click reaches
  // eve's `respond`, which is the wiring only the panel can provide.
  await userEvent.click(screen.getByRole("button", { name: "capture_memory" }));

  await waitFor(() =>
    expect(eve.responded).toEqual([[{ requestId: "req-1", optionId: "approve" }]]),
  );
});

it("will not let a decision go out while eve is busy with another turn", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnAwaitingApproval, "streaming");
  });

  const decide = screen.getByRole("button", { name: "capture_memory" }) as HTMLButtonElement;
  expect(decide.disabled).toBe(true);
});

/**
 * A turn that stopped to look something up, with the model's own account of why.
 * The lookup is `line`-tier, so it belongs in the activity block above the answer
 * rather than trailing beneath it as it used to.
 */
const turnWithReasoningAndLookup: readonly [EveMessage, EveMessage] = [
  { id: "turn_0:user", role: "user", parts: [{ type: "text", text: "What about Priya?" }] },
  {
    id: "turn_0:assistant",
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: "They want the notebook, not the web.",
        state: "done",
        stepIndex: 0,
      },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "search_people",
        state: "output-available",
        input: {},
        output: { people: [] },
      },
      { type: "text", text: "Priya Shah works at a bakery.", state: "done", stepIndex: 0 },
    ],
  },
];

it("folds the turn's thinking and lookups above the answer, not under it", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnWithReasoningAndLookup, "ready");
  });

  // Collapsed by default, and the trigger says what happened rather than naming
  // a tool. The lookup itself is not on screen until the fold is opened.
  const trigger = screen.getByRole("button", { name: /Thought (it through|for)/ });
  expect(screen.queryByText("Searched people")).toBeNull();

  await userEvent.click(trigger);

  expect(screen.getByText("They want the notebook, not the web.")).toBeDefined();
  expect(screen.getByText("Searched people")).toBeDefined();
  // The whole point: the raw tool name never reaches the transcript.
  expect(screen.queryByText("search people")).toBeNull();
});

it("says it worked, not that it thought, when there was no reasoning to show", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(
      [
        turnWithReasoningAndLookup[0],
        {
          ...turnWithReasoningAndLookup[1],
          parts: turnWithReasoningAndLookup[1].parts.filter((part) => part.type !== "reasoning"),
        },
      ] as readonly EveMessage[],
      "ready",
    );
  });

  expect(screen.getByRole("button", { name: /Worked (on it|for)/ })).toBeDefined();
});

it("copies the answer and asks again from the finished turn", async () => {
  const written: string[] = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });

  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnWithReasoningAndLookup, "ready");
  });

  await userEvent.click(screen.getByRole("button", { name: "Copy answer" }));
  await waitFor(() => expect(written).toEqual(["Priya Shah works at a bakery."]));

  // Retry re-sends the message that started the turn, not the answer.
  await userEvent.click(screen.getByRole("button", { name: "Ask again" }));
  await waitFor(() => expect(eve.sent).toEqual(["What about Priya?"]));
});

it("puts a message of your own back in the composer to edit", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnWithReasoningAndLookup, "ready");
  });

  await userEvent.click(screen.getByRole("button", { name: "Edit and send again" }));

  await waitFor(() => expect(composer().value).toBe("What about Priya?"));
});

/**
 * "Eve" is the framework's name, not the product's. It may live in identifiers
 * forever; it may never reach a reader.
 */
it("never says Eve to the reader", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  expect(document.body.textContent).not.toMatch(/\bEve\b/);

  await act(async () => {
    eve.showTurn(turnWithReasoningAndLookup, "ready");
  });

  expect(document.body.textContent).not.toMatch(/\bEve\b/);
});

/**
 * The page surface: one panel, two layouts.
 *
 * `/assistant` opens with the composer risen to the middle of the column under a
 * greeting, and settles it to the bottom on the first message. The two positions
 * are one flex column with a spacer below the composer whose growth is animated
 * away, so what these assert is the state that drives the move rather than the
 * pixels — jsdom computes no layout.
 */
it("opens a page conversation with the greeting and starters, and drops them on the first message", async () => {
  render(<AssistantPanel ownerUserId="owner-1" surface="page" />);

  expect(screen.getByRole("heading", { name: "What do you want to remember?" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Who should I reach out to this week?" }),
  ).toBeDefined();

  await sendMessage("Mara adopted a cat");
  await act(async () => {
    eve.showTurn(
      [
        {
          id: "turn_0:user",
          role: "user",
          parts: [{ type: "text", text: "Mara adopted a cat", state: "done" }],
        },
      ] as readonly EveMessage[],
      "streaming",
    );
  });

  // The invitation has done its job and the transcript owns the column.
  expect(screen.queryByRole("heading", { name: "What do you want to remember?" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Who should I reach out to this week?" })).toBeNull();
  expect(screen.getByRole("textbox")).toBeDefined();
});

/** The dashboard column is too short for the move to read as anything but a jump. */
it("keeps the dashboard panel's own centred empty state instead of the page's", () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  expect(screen.getByText("What do you want to remember?")).toBeDefined();
  expect(screen.queryByRole("heading", { name: "What do you want to remember?" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Who should I reach out to this week?" })).toBeNull();
});

/**
 * A thread whose last durable event is `session.waiting` is finished: nothing is
 * running in it and nothing ever will until someone sends a message. Asking eve
 * to resume it means following a stream with nothing left to say, which ends only
 * at the client's fifteen-second idle timeout - fifteen seconds during which the
 * status is `resuming` and the composer refuses every message. So the panel reads
 * the stream first, hands the events over as the session's starting state, and
 * asks for a follow only when one is warranted.
 */
it("reopens a settled thread with its transcript and no follow at all", async () => {
  eve.holds([{ type: "message.received" }, { type: "session.waiting" }]);

  await openThread(<AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" />);

  expect(eve.mounted[0]).toEqual({
    initialEvents: [{ type: "message.received" }, { type: "session.waiting" }],
    initialSession: { sessionId: "wrun_A", streamIndex: 2 },
    resume: false,
  });
  expect(eve.resumed).toEqual([]);
  // And the composer is live immediately, rather than after the timeout.
  expect((composer() as HTMLTextAreaElement).disabled).toBe(false);
});

/** A turn genuinely still in flight is exactly what `resume` is for. */
it("follows a thread whose last turn is still running", async () => {
  eve.holds([{ type: "session.waiting" }, { type: "step.started" }]);

  await openThread(<AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" />);

  expect(eve.resumed).toEqual([{ sessionId: "wrun_A", streamIndex: 2 }]);
});

/**
 * An outage while reading the prefix is not an answer about the thread. Falling
 * back to eve's own resume is slower on a settled thread but never wrong, which
 * is the direction to be wrong in.
 */
it("falls back to eve's own resume when the stream cannot be read", async () => {
  eve.refuses(new Error("network down"));

  await openThread(<AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" />);

  expect(eve.mounted[0]).toEqual({
    initialEvents: [],
    initialSession: { sessionId: "wrun_A", streamIndex: 0 },
    resume: true,
  });
});

it("holds turn-shaped space while a reopened thread has nothing on screen yet", async () => {
  await openThread(
    <AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" surface="page" />,
  );

  await act(async () => {
    eve.setStatus("resuming");
  });

  // Neither the greeting (nothing has happened yet is a lie about a thread with
  // history) nor a spinner - the shape of what is about to land.
  expect(screen.queryByRole("heading", { name: "What do you want to remember?" })).toBeNull();
  expect(screen.getByRole("log").getAttribute("aria-busy")).toBe("true");
});

/**
 * Replayed messages are the thread. Once any of them are on screen, holding the
 * skeleton over them because eve is still following a live turn hides a
 * conversation the reader could already be reading.
 */
it("shows the transcript as soon as it has one, even while a turn is still resuming", async () => {
  await openThread(
    <AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" surface="page" />,
  );

  await act(async () => {
    eve.showTurn(
      [
        {
          id: "turn_0:assistant",
          role: "assistant",
          parts: [{ type: "text", text: "Priya Shah works at a bakery.", state: "done" }],
        },
      ] as readonly EveMessage[],
      "resuming",
    );
  });

  expect(screen.getByText("Priya Shah works at a bakery.")).toBeDefined();
  expect(screen.getByRole("log").getAttribute("aria-busy")).toBeNull();
});

/**
 * Eve mints the session id and forgets it, so the browser is the only thing that
 * can tell Tendnote a thread exists before the first reply lands (ADR 0238).
 */
it("announces a new session with the message that started it", async () => {
  const started: [string, string][] = [];
  render(
    <AssistantPanel
      onSessionStarted={(sessionId, firstMessage) => started.push([sessionId, firstMessage])}
      ownerUserId="owner-1"
    />,
  );

  await sendMessage("Mara adopted a cat");
  await act(async () => {
    eve.nameSession("wrun_new");
  });

  expect(started).toEqual([["wrun_new", "Mara adopted a cat"]]);
});

it("never announces a thread it was handed, because that row already exists", async () => {
  const started: string[] = [];
  await openThread(
    <AssistantPanel
      initialSessionId="wrun_A"
      onSessionStarted={(sessionId) => started.push(sessionId)}
      ownerUserId="owner-1"
    />,
  );

  await act(async () => {
    eve.nameSession("wrun_A");
  });

  expect(started).toEqual([]);
});

/**
 * Eve sessions expire on an absolute clock. The transcript stays readable and
 * the composer must go: one that will refuse every message is worse than none.
 */
it("closes the composer and offers a way forward when the session has ended", async () => {
  await openThread(
    <AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" surface="page" />,
  );

  await act(async () => {
    eve.showTurn(
      [
        {
          id: "turn_0:assistant",
          role: "assistant",
          parts: [{ type: "text", text: "Priya Shah works at a bakery.", state: "done" }],
        },
      ] as readonly EveMessage[],
      "ready",
    );
  });

  await act(async () => {
    eve.failWith(
      Object.assign(new Error("The session is no longer active."), {
        code: "session_not_active",
        status: 409,
      }),
    );
  });

  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(screen.getByText(/This conversation has ended/)).toBeDefined();
  expect(screen.getByRole("link", { name: "Start a new conversation" }).getAttribute("href")).toBe(
    "/assistant",
  );
  // The history is the point: it is still all there to read.
  expect(screen.getByText("Priya Shah works at a bakery.")).toBeDefined();
});

/**
 * The words the ending overtook. They were never sent, and deleting them at the
 * exact moment the session dies is the failure the queue exists to prevent - the
 * user believes they are pending.
 */
it("keeps queued messages visible, and read-only, when the session ends", async () => {
  await openThread(
    <AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" surface="page" />,
  );

  await sendMessage("Mara adopted a cat");
  await sendMessage("And she moved to Lisbon");
  await waitFor(() => expect(screen.getByText("And she moved to Lisbon")).toBeDefined());

  await act(async () => {
    eve.failWith(
      Object.assign(new Error("The session is no longer active."), {
        code: "session_not_active",
        status: 409,
      }),
    );
  });

  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  // Still there, still named, and plainly not going anywhere.
  expect(screen.getByText("And she moved to Lisbon")).toBeDefined();
  expect(screen.getByText("These weren't sent.")).toBeDefined();
  // Send now would send into a session that refuses everything.
  expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();

  // Remove still works, so the reader can clear the list once they are done with it.
  await userEvent.click(screen.getByRole("button", { name: "Remove from the queue" }));
  await waitFor(() => expect(screen.queryByText("And she moved to Lisbon")).toBeNull());
});

/**
 * Reopening a thread the mount will not hand back ends it too. That refusal now
 * arrives on the pre-read rather than after eve has spent ~30s retrying it, so
 * the composer is never on screen at all - which is the point, because one over a
 * session that can never take a message is what DESIGN.md §5 rules out.
 */
it("closes the composer when a reopened thread's stream is refused", async () => {
  eve.refuses(
    Object.assign(new Error("Session not found."), {
      name: "ClientError",
      status: 404,
      body: '{"error":"Session not found.","ok":false}',
    }),
  );

  await openThread(
    <AssistantPanel initialSessionId="wrun_A" ownerUserId="owner-1" surface="page" />,
  );

  await waitFor(() => expect(screen.getByText(/This conversation has ended/)).toBeDefined());
  expect(screen.queryByRole("textbox")).toBeNull();
  // Nothing to replay and nothing to follow: the stream is closed to us.
  expect(eve.mounted[0]).toEqual({
    initialEvents: undefined,
    initialSession: { sessionId: "wrun_A", streamIndex: 0 },
    resume: undefined,
  });
});

/** An outage is not an ending: the composer stays, because the next try may work. */
it("keeps the composer when the failure is an ordinary outage", async () => {
  render(<AssistantPanel ownerUserId="owner-1" surface="page" />);

  await sendMessage("Mara adopted a cat");
  await settleTurn(new Error("stream closed"));

  await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  expect(screen.getByRole("textbox")).toBeDefined();
  expect(screen.queryByText(/This conversation has ended/)).toBeNull();
});

/** A live conversation follows the owner to the page rather than being left behind. */
it("points the dashboard's Open link at the conversation already under way", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  expect(screen.getByRole("link", { name: "Open the Assistant page" }).getAttribute("href")).toBe(
    "/assistant",
  );

  await act(async () => {
    eve.nameSession("wrun_new");
  });

  expect(
    screen
      .getByRole("link", { name: "Open this conversation on the Assistant page" })
      .getAttribute("href"),
  ).toBe("/assistant/wrun_new");
});

/**
 * The gap this closes: a turn used to say "Thinking…" for half a second, then go
 * blank for another half second, then say "Working…" - two indicators for one
 * wait, with nothing between them. There is one indicator now, and the moment the
 * turn has a message of its own the disclosure carries it. What has to hold is
 * that they never both say it and never both stop saying it.
 */
it("hands the working indicator to the live turn instead of doubling it", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  // A live turn that has not produced a thought or a tool call yet: no reasoning,
  // no steps, nothing to fold - and still an indicator, because it is working.
  await act(async () => {
    eve.showTurn(
      [
        { id: "turn_0:user", role: "user", parts: [{ type: "text", text: "What about Priya?" }] },
        { id: "turn_0:assistant", role: "assistant", parts: [] },
      ] as readonly EveMessage[],
      "streaming",
    );
  });

  // One indicator, not two. (`Shimmer` stacks a readable base under a decorative
  // aria-hidden band, so the base layer is what counts the indicators.)
  expect(screen.getAllByText("Working…", { selector: ".tn-shimmer-base" })).toHaveLength(1);
  // And it is the turn's own disclosure carrying it, not the standalone line.
  expect(screen.getByRole("button", { name: "Working…" })).toBeDefined();
});

/** The word is gone: a turn is working, not thinking, until it says how long it thought. */
it("never says Thinking", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await sendMessage("Mara adopted a cat");
  await act(async () => {
    eve.showTurn(
      [{ id: "turn_0:assistant", role: "assistant", parts: [] }] as readonly EveMessage[],
      "streaming",
    );
  });

  expect(document.body.textContent).not.toMatch(/Thinking/);
});

/** A turn that is over and did nothing worth folding has no disclosure at all. */
it("shows no disclosure for a settled turn that only answered", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(
      [
        {
          id: "turn_0:assistant",
          role: "assistant",
          parts: [{ type: "text", text: "Priya Shah works at a bakery.", state: "done" }],
        },
      ] as readonly EveMessage[],
      "ready",
    );
  });

  expect(screen.queryByRole("button", { name: /Worked|Thought|Working/ })).toBeNull();
});

/**
 * The disclosure auto-opens while a turn streams, which is right - and used to be
 * impossible to undo, because the shell's auto-open effect re-ran on every commit
 * and reopened it the instant the reader closed it. A reader who wants a noisy
 * turn out of the way gets it out of the way, and it stays out of the way for the
 * rest of the stream.
 */
it("lets the reader collapse the activity while the turn is still streaming", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnWithReasoningAndLookup, "streaming");
  });

  // Auto-opened: the reasoning is on screen without anyone asking.
  expect(screen.getByText("They want the notebook, not the web.")).toBeDefined();

  await userEvent.click(screen.getByRole("button", { name: "Working…" }));
  await waitFor(() =>
    expect(screen.queryByText("They want the notebook, not the web.")).toBeNull(),
  );

  // More of the same turn arrives; the reader's decision survives it.
  await act(async () => {
    eve.showTurn(turnWithReasoningAndLookup, "streaming");
  });

  expect(screen.queryByText("They want the notebook, not the web.")).toBeNull();
});

/**
 * The model calls `suggest_next_steps` to write the follow-up chips. It is the
 * app talking to itself, so it must not appear as a step in the activity, as a
 * card, or as a line - the reader sees only the chips it produced.
 */
const turnWithProposedFollowUps: readonly EveMessage[] = [
  { id: "turn_1:user", role: "user", parts: [{ type: "text", text: "What about Priya?" }] },
  {
    id: "turn_1:assistant",
    role: "assistant",
    parts: [
      { type: "text", text: "Priya Shah works at a bakery.", state: "done", stepIndex: 0 },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "suggest_next_steps",
        state: "output-available",
        input: {},
        output: { suggestions: ["Tell me about her sister", "What about Priya?"] },
      },
    ],
  },
];

it("offers the model's own follow-ups without ever naming the tool that wrote them", async () => {
  render(<AssistantPanel ownerUserId="owner-1" />);

  await act(async () => {
    eve.showTurn(turnWithProposedFollowUps, "ready");
  });

  expect(screen.getByRole("button", { name: "Tell me about her sister" })).toBeDefined();
  // Already asked this turn - offering it back is the conversation forgetting itself.
  expect(screen.queryByRole("button", { name: "What about Priya?" })).toBeNull();
  // The call left no trace: no activity disclosure, no line, no card.
  expect(screen.queryByRole("button", { name: /Worked|Thought/ })).toBeNull();
  expect(document.body.textContent).not.toMatch(/suggest.next.steps/i);
});
