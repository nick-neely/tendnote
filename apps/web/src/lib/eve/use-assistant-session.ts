"use client";

import { Client, type MessageStreamEvent } from "eve/client";
import { type EveMessageData, type UseEveAgentHelpers, useEveAgent } from "eve/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isSessionNotActive } from "@/lib/assistant/session-errors";
import { resumePlanFromEvents } from "@/lib/eve/resume-plan";
import {
  type SelectedPersonContext,
  selectedPersonClientContext,
} from "@/lib/eve/selected-person-context";

/**
 * The panel's one Eve session, and the honest way to send into it.
 *
 * Three things are tangled together here on purpose, because they are one fact
 * about a turn: eve's store resolves `send` whether the turn worked or not, it
 * announces the failure through `onError` instead, and one particular failure
 * ("this conversation has ended") is not an error the reader should be asked to
 * retry. Splitting them would leave the panel holding the ref that joins them.
 */

/** Sends one message as a turn, or refuses. Everything the transcript can do to the session. */
export type SendPrompt = (text: string, options?: { steer?: boolean }) => Promise<void>;

/**
 * `useEveAgent` is overloaded, and `ReturnType` picks the generic overload with
 * `TData` unresolved - so naming the default projection is what keeps
 * `agent.data.messages` typed rather than `unknown`.
 */
export type AssistantAgent = UseEveAgentHelpers<EveMessageData>;
export type AssistantAgentStatus = AssistantAgent["status"];

/**
 * What the app knows about a thread before it opens a session on it.
 *
 * `useEveAgent` reads its session configuration once, when it builds its store,
 * so this verdict has to exist *before* the hook runs - which is why it is its
 * own state rather than something the session hook resolves for itself. The
 * caller renders a reserve until it settles (see {@link useResumedSession}).
 */
export type AssistantResumeState =
  /** A reopened thread whose stream has not been read yet. */
  | { readonly kind: "pending" }
  /** A new conversation: eve mints the session on the first message. */
  | { readonly kind: "fresh" }
  /** A reopened thread, with everything already said in it. */
  | {
      readonly kind: "replay";
      readonly sessionId: string;
      readonly events: readonly MessageStreamEvent[];
      readonly streamIndex: number;
      /** Only when a turn is genuinely still running (see `resume-plan.ts`). */
      readonly resume: boolean;
    }
  /** A thread the mount will not hand back: expired, or never this owner's. */
  | { readonly kind: "ended"; readonly sessionId: string };

/** The verdict once it has settled - the only thing a session can be opened on. */
export type AssistantResumeSettled = Exclude<AssistantResumeState, { kind: "pending" }>;

/**
 * Reads a reopened thread's durable stream once, before any session exists.
 *
 * This is a plain bounded read - open the stream at 0, take everything through
 * the tail, close - with reconnection turned off. Reconnection matters here
 * because eve treats a 404 on stream open as retryable and spends about thirty
 * seconds on twelve attempts before giving up; for the mount's deliberately
 * opaque "not yours / no such session" 404 (ADR 0238) the first answer is the
 * final one, and thirty seconds of retrying it is thirty seconds of skeleton.
 *
 * Everything else - an outage, a truncated read - falls back to exactly what the
 * panel did before this existed: hand eve the session id and let it resume. That
 * path is slow on a settled thread, but it is never wrong, and preferring it to
 * a guess is what keeps a flaky network from looking like an ended conversation.
 */
export function useResumedSession(sessionId?: string): AssistantResumeState {
  const [state, setState] = useState<AssistantResumeState>(() =>
    sessionId ? { kind: "pending" } : { kind: "fresh" },
  );

  useEffect(() => {
    if (!sessionId) {
      setState({ kind: "fresh" });
      return;
    }

    setState({ kind: "pending" });
    const reader = new AbortController();

    void readSessionEvents(sessionId, reader.signal)
      .then((events) => {
        if (reader.signal.aborted) return;
        setState({ kind: "replay", sessionId, ...resumePlanFromEvents(events), events });
      })
      .catch((error: unknown) => {
        if (reader.signal.aborted) return;
        setState(
          isSessionNotActive(error)
            ? { kind: "ended", sessionId }
            : { kind: "replay", sessionId, events: [], resume: true, streamIndex: 0 },
        );
      });

    return () => reader.abort();
  }, [sessionId]);

  return state;
}

/** One bounded pass over a session's durable stream, from the beginning to the tail. */
async function readSessionEvents(
  sessionId: string,
  signal: AbortSignal,
): Promise<MessageStreamEvent[]> {
  // Same-origin, exactly like the agent hook's default: the eve mount lives under
  // this app's own routes, so the owner's session cookie travels with the read.
  const session = new Client({ host: "" }).sessions.attach(sessionId, { streamIndex: 0 });
  const events: MessageStreamEvent[] = [];
  for await (const event of session.stream({
    follow: false,
    signal,
    startIndex: 0,
    streamReconnectPolicy: { reconnect: false },
  })) {
    events.push(event);
  }
  return events;
}

/** What a settled verdict tells `useEveAgent` about the session to open. */
function eveSessionConfig(resumed: AssistantResumeSettled) {
  switch (resumed.kind) {
    case "fresh":
      return {};
    // Nothing to replay and nothing to follow: the stream is closed to us. The
    // session is still named so the transcript region knows which thread it is
    // standing in, and `ended` takes the composer away.
    case "ended":
      return { initialSession: { sessionId: resumed.sessionId, streamIndex: 0 } };
    case "replay":
      return {
        initialEvents: resumed.events,
        initialSession: { sessionId: resumed.sessionId, streamIndex: resumed.streamIndex },
        resume: resumed.resume,
      };
  }
}

export function useAssistantSession({
  context,
  onSessionStarted,
  resumed,
}: {
  context?: SelectedPersonContext;
  /**
   * The pre-read verdict for this thread ({@link useResumedSession}). Read
   * exactly once, on mount: `useEveAgent` builds its store the first time it runs
   * and ignores every later config change, so a caller switching threads must
   * remount with a new `key` (eve's own guidance).
   */
  resumed: AssistantResumeSettled;
  /**
   * Announces the session id the moment Eve mints one for a *new* conversation,
   * with the message that started it. Eve has no session index (ADR 0238), so
   * the browser is the first thing that knows a thread exists.
   */
  onSessionStarted?: (sessionId: string, firstMessage: string) => void;
}): { agent: AssistantAgent; deliver: SendPrompt; ended: boolean } {
  const resumedSessionId = resumed.kind === "fresh" ? undefined : resumed.sessionId;

  // A turn that fails does not reject. Eve's store catches the network or stream
  // error itself, parks it on `status: "error"`, and *resolves* `send` - so the
  // composer's restore-on-rejection contract would never fire and the message
  // would be gone with nothing to show for it. `onError` is the store's only
  // signal that the turn it just settled actually failed; we hold the failure
  // here so `deliver` can rethrow it and put the text back.
  const turnFailure = useRef<Error | null>(null);

  // The words that opened this conversation, held until Eve names the session
  // they started. `onSessionChange` carries the id and nothing else, and the
  // title ladder needs the message (ADR 0238).
  const openingMessage = useRef<string | null>(null);
  // The session already announced. Seeded with a resumed id so reattaching to an
  // existing thread never re-announces it as new.
  const announcedSession = useRef<string | undefined>(resumedSessionId);

  // A conversation whose Eve session has expired, or whose stream the mount will
  // not reopen. Its transcript stays readable; its composer must not. The pre-read
  // can already know this - a refused stream is the same dead end a refused send
  // reaches - so the composer never appears rather than appearing and dying.
  const [ended, setEnded] = useState(resumed.kind === "ended");

  // Stream turns directly from the same-origin Eve mount (withEve). The hook owns
  // the durable Eve session, so follow-up turns continue the same conversation
  // without a Tendnote chat transcript (ADR 0030). Durable product state still
  // lives in source records, memories, and follow-ups (ADR 0029). A thread the
  // owner reopened is seeded with its own durable events rather than a Tendnote
  // copy, and follows the stream only when a turn is actually still running.
  const agent = useEveAgent({
    ...eveSessionConfig(resumed),
    onError: (error) => {
      turnFailure.current = error;
      if (isSessionNotActive(error)) setEnded(true);
    },
    // Re-registered on every render by the hook, so this closure is always the
    // current one and needs no ref of its own.
    onSessionChange: (session) => {
      const sessionId = session?.sessionId;
      if (!sessionId || announcedSession.current === sessionId) return;
      announcedSession.current = sessionId;
      onSessionStarted?.(sessionId, openingMessage.current ?? "");
    },
  });

  const { send } = agent;

  /**
   * Hands one message to Eve and reports the turn's real verdict.
   *
   * `send` resolving says nothing about whether the turn worked, so this rethrows
   * whatever `onError` parked. With `steer`, eve cancels the turn in flight and
   * replaces it - the only way past its one-turn-at-a-time rule.
   */
  const deliver = useCallback<SendPrompt>(
    async (text, options) => {
      // A failure belongs to the turn that produced it. Clearing it as this send
      // starts is what keeps a stale verdict from rejecting the next message; the
      // store retires its own `error` at the same moment.
      turnFailure.current = null;
      openingMessage.current ??= text;

      await send(text, {
        clientContext: selectedPersonClientContext(context),
        ...(options?.steer ? { turnPolicy: "steer" as const } : {}),
      });

      const failure = turnFailure.current;
      if (failure) {
        turnFailure.current = null;
        throw failure;
      }
    },
    [context, send],
  );

  return { agent, deliver, ended };
}
