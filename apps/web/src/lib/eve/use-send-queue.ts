"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { isTurnInFlight } from "@/lib/eve/message-views";
import {
  EMPTY_SEND_QUEUE,
  nextQueuedMessage,
  type QueuedMessage,
  queueToDraft,
  sendQueueReducer,
} from "@/lib/eve/send-queue";
import type { AssistantAgentStatus, SendPrompt } from "@/lib/eve/use-assistant-session";
import { loadLocalComposerDraft, saveLocalComposerDraft } from "@/lib/local-composer-draft";

/**
 * The composer's hand-off, queue and all.
 *
 * `lib/eve/send-queue.ts` is the state machine; this is the only thing that
 * touches a session with it. Everything a caller needs is one of four verbs, so
 * the panel never has to know that "send" and "queue" are the same gesture at
 * two different moments.
 */
export type AssistantSendQueueControls = {
  readonly items: readonly QueuedMessage[];
  /**
   * Take one message from the composer: sent now if the session is free, queued
   * if a turn is running, ignored if it is only whitespace. Rejects exactly when
   * the turn it started failed, which is the composer's restore contract.
   */
  readonly submit: (text: string) => Promise<void>;
  readonly remove: (id: string) => void;
  /** Cancel the running turn and replace it with this queued message. */
  readonly sendNow: (id: string) => void;
};

export function useSendQueue({
  deliver,
  ownerUserId,
  status,
}: {
  deliver: SendPrompt;
  /**
   * Whose device-local draft absorbs anything still queued when this hook goes
   * away. Optional only so a caller with no owner yet (there is none today) is
   * not forced to invent one; without it, a queue torn down mid-line is simply
   * lost, same as before this existed.
   */
  ownerUserId?: string;
  status: AssistantAgentStatus;
}): AssistantSendQueueControls {
  const [queue, dispatch] = useReducer(sendQueueReducer, EMPTY_SEND_QUEUE);
  const nextId = useRef(0);
  // Read only from the unmount effect below, so it sees the queue as it stood
  // the instant this hook went away rather than the queue at whatever render
  // last committed the effect - the point of this ref is precisely to avoid
  // re-running that effect on every dispatch.
  const queueAtUnmount = useRef(queue);
  queueAtUnmount.current = queue;

  /**
   * A message typed while a turn is running is *queued* rather than refused: it
   * resolves, so the composer clears, and the words are immediately visible in
   * the queue strip above it. Refusing used to be the honest answer because there
   * was nowhere for the message to go; now there is.
   */
  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) {
        return;
      }
      if (isTurnInFlight(status)) {
        nextId.current += 1;
        dispatch({ id: `queued-${nextId.current}`, text, type: "enqueue" });
        return;
      }
      await deliver(text);
    },
    [deliver, status],
  );

  const remove = useCallback((id: string) => dispatch({ id, type: "remove" }), []);

  const sendNow = useCallback(
    (id: string) => {
      const item = queue.items.find((queued) => queued.id === id);
      if (!item) return;
      dispatch({ id, type: "remove" });
      // The transcript already says what happened to a steered turn that failed:
      // its message stays as "Not sent" and the status line names the outage.
      void deliver(item.text, { steer: true }).catch(() => {});
    },
    [deliver, queue.items],
  );

  // Drain one queued message per settled turn, in order. The item leaves the
  // queue as it is handed off - from that moment it is in the transcript, either
  // as a turn or as a "Not sent" bubble - and a failure parks the rest rather
  // than throwing the whole queue at a session that is refusing work.
  useEffect(() => {
    const next = nextQueuedMessage(queue);
    if (!next || status !== "ready") {
      return;
    }
    dispatch({ id: next.id, type: "start" });
    void deliver(next.text)
      .catch(() => dispatch({ type: "pause" }))
      .finally(() => dispatch({ id: next.id, type: "settle" }));
  }, [deliver, queue, status]);

  // A queue that still has items when this hook is torn down - most often the
  // panel remounting on a thread switch - would otherwise vanish silently, which
  // is exactly the promise `send-queue.ts` says the queue exists to keep: a
  // message held invisibly is a message the user believes they sent. There is
  // nowhere left to render the queue strip once this hook is gone, so the items
  // move into the composer's own device-local draft instead, where the panel that
  // mounts next already knows how to hand them back ("Unsaved draft restored on
  // this device."). Runs once, on unmount only - `queueAtUnmount` is what lets it
  // skip re-running on every dispatch in between.
  useEffect(() => {
    if (!ownerUserId) {
      return;
    }
    const owner = ownerUserId;
    return () => {
      const items = queueAtUnmount.current.items;
      if (items.length === 0) {
        return;
      }
      try {
        const existing = loadLocalComposerDraft(window.localStorage, owner, "eve");
        const merged = queueToDraft(existing.value, items);
        saveLocalComposerDraft(window.localStorage, owner, "eve", merged);
      } catch {
        // Best effort: a blocked or full local store must never block the
        // unmount it is running inside of.
      }
    };
  }, [ownerUserId]);

  return { items: queue.items, remove, sendNow, submit };
}
