/**
 * The composer's own send queue.
 *
 * Eve accepts one turn at a time: `send` throws while a turn is in flight, and
 * the only way past that is `turnPolicy: "steer"`, which *cancels* the running
 * turn and replaces it. There is no framework queue, so "type the next thought
 * while this one finishes" has to be an app-owned list - and it has to be a list
 * the user can see, reorder their mind about, and remove from, because a message
 * held invisibly is a message the user believes they sent.
 *
 * This module is the whole state machine: plain data in, plain data out, no
 * timers and no session. The panel owns only the effect that drains it, and even
 * the "one at a time" rule lives here rather than in a ref, so the drain effect's
 * dependencies are exactly the state it reads.
 */

/** One message waiting for the current turn to finish. */
export type QueuedMessage = {
  readonly id: string;
  readonly text: string;
};

export type SendQueueState = {
  readonly items: readonly QueuedMessage[];
  /**
   * The id of the message currently being handed to Eve, if any. It has already
   * left {@link items} — from the moment it is sent it lives in the transcript,
   * as a turn or as a "Not sent" bubble — but the queue still has to know a
   * hand-off is outstanding so the next one waits its turn.
   */
  readonly sending: string | null;
  /**
   * Whether automatic draining is stopped. A queued send that fails must not be
   * retried in a loop against a session that is refusing work, so the failure
   * parks the queue with its remaining items intact: they stay visible, "Send
   * now" still works, and the next thing the user types resumes the drain.
   */
  readonly paused: boolean;
};

export const EMPTY_SEND_QUEUE: SendQueueState = { items: [], paused: false, sending: null };

export type SendQueueAction =
  /** The user sent while a turn was in flight. */
  | { readonly type: "enqueue"; readonly id: string; readonly text: string }
  /** The user removed one item, or took it out to send it immediately. */
  | { readonly type: "remove"; readonly id: string }
  /** This item is being handed to Eve now. */
  | { readonly type: "start"; readonly id: string }
  /** The hand-off finished, however it went. */
  | { readonly type: "settle"; readonly id: string }
  /** An auto-send failed: keep every remaining item, stop draining. */
  | { readonly type: "pause" };

function withoutItem(state: SendQueueState, id: string): SendQueueState {
  const items = state.items.filter((item) => item.id !== id);
  return items.length === state.items.length ? state : { ...state, items };
}

export function sendQueueReducer(state: SendQueueState, action: SendQueueAction): SendQueueState {
  switch (action.type) {
    case "enqueue": {
      const text = action.text.trim();
      if (!text) {
        return state;
      }
      // Typing again is the user asking for the queue to move, so it also lifts
      // a pause left by an earlier failure. `error` on the session is the last
      // turn's verdict, never a reason to refuse the next message.
      return { ...state, items: [...state.items, { id: action.id, text }], paused: false };
    }
    case "remove":
      return withoutItem(state, action.id);
    case "start":
      return { ...withoutItem(state, action.id), sending: action.id };
    case "settle":
      return state.sending === action.id ? { ...state, sending: null } : state;
    default:
      return state.paused ? state : { ...state, paused: true };
  }
}

/**
 * The item the panel should hand over next, or `null` when nothing should go out
 * yet. One at a time and in order: the queue is a line, not a batch, and a turn
 * that is still settling must not have a second message stacked on top of it.
 */
export function nextQueuedMessage(state: SendQueueState): QueuedMessage | null {
  if (state.paused || state.sending !== null) {
    return null;
  }
  return state.items[0] ?? null;
}
