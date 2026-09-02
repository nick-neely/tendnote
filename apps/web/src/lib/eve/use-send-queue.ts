"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { isTurnInFlight } from "@/lib/eve/message-views";
import {
  EMPTY_SEND_QUEUE,
  nextQueuedMessage,
  type QueuedMessage,
  sendQueueReducer,
} from "@/lib/eve/send-queue";
import type { AssistantAgentStatus, SendPrompt } from "@/lib/eve/use-assistant-session";

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
  status,
}: {
  deliver: SendPrompt;
  status: AssistantAgentStatus;
}): AssistantSendQueueControls {
  const [queue, dispatch] = useReducer(sendQueueReducer, EMPTY_SEND_QUEUE);
  const nextId = useRef(0);

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

  return { items: queue.items, remove, sendNow, submit };
}
