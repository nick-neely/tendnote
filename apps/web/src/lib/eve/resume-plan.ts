import type { MessageStreamEvent } from "eve/client";

/**
 * How to reattach to a thread whose durable stream we have already read.
 *
 * Eve's `resume()` does two jobs in one call: it replays the stream from event 0
 * to rebuild the transcript, and then it *follows* the stream waiting for the
 * in-flight turn to reach a boundary. The second job is the expensive one, and
 * on a thread nobody is talking in it never finishes: the tail is already
 * `session.waiting`, no further event will ever arrive, and the follow loop ends
 * only when eve's 15s stream-read idle timeout aborts it. For those fifteen
 * seconds the store sits at `status: "resuming"`, which means the composer is
 * refusing messages and the queue is holding them - on a thread that is, in
 * fact, completely idle.
 *
 * So the app reads the prefix itself (one bounded `follow: false` pass), hands
 * the events to `useEveAgent` as `initialEvents`, and asks for `resume` only
 * when the tail says a turn is genuinely still running. A settled thread then
 * mounts straight into `ready` with its whole transcript already projected.
 */

/**
 * The event types that end a turn. A stream whose last event is one of these has
 * nothing further to say until someone sends a message, so following it is a
 * fifteen-second wait for silence.
 *
 * This mirrors eve's own `isCurrentTurnBoundaryEvent`, which the package does not
 * export from `eve/client`. The list is short, stable, and part of the wire
 * protocol; restating it is cheaper than reaching into the package's internals,
 * and being wrong in the conservative direction (an unrecognized tail resumes)
 * is the behavior this replaces anyway.
 */
const SETTLED_TAIL_EVENTS: ReadonlySet<MessageStreamEvent["type"]> = new Set([
  "session.completed",
  "session.failed",
  "session.waiting",
]);

/** What to hand `useEveAgent` for a thread whose prefix has already been read. */
export type ResumePlan = {
  /**
   * The cursor the events end at. It has to equal `initialEvents.length` exactly:
   * eve only starts its own catch-up read at the tail when the two agree, and
   * replays from 0 otherwise.
   */
  readonly streamIndex: number;
  /** Whether a turn is still running and therefore worth following. */
  readonly resume: boolean;
};

/**
 * Reads a session's own tail to decide whether anything is still happening in it.
 *
 * An empty prefix resumes: a session id with no events yet is either about to
 * produce some or does not exist, and both of those are eve's question to answer
 * rather than ours.
 */
export function resumePlanFromEvents(events: readonly MessageStreamEvent[]): ResumePlan {
  const tail = events.at(-1);
  return {
    resume: tail === undefined || !SETTLED_TAIL_EVENTS.has(tail.type),
    streamIndex: events.length,
  };
}
