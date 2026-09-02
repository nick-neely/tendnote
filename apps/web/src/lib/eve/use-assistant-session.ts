"use client";

import { type EveMessageData, type UseEveAgentHelpers, useEveAgent } from "eve/react";
import { useCallback, useRef, useState } from "react";
import { isSessionNotActive } from "@/lib/assistant/session-errors";
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

export function useAssistantSession({
  context,
  initialSessionId,
  onSessionStarted,
}: {
  context?: SelectedPersonContext;
  /**
   * A prior Eve session to reopen instead of starting a fresh one. Read exactly
   * once, on mount: `useEveAgent` builds its store the first time it runs and
   * ignores every later config change, so a caller switching threads must
   * remount with a new `key` (eve's own guidance).
   */
  initialSessionId?: string;
  /**
   * Announces the session id the moment Eve mints one for a *new* conversation,
   * with the message that started it. Eve has no session index (ADR 0238), so
   * the browser is the first thing that knows a thread exists.
   */
  onSessionStarted?: (sessionId: string, firstMessage: string) => void;
}): { agent: AssistantAgent; deliver: SendPrompt; ended: boolean } {
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
  const announcedSession = useRef<string | undefined>(initialSessionId);

  // A conversation whose Eve session has expired, or whose stream the mount will
  // not reopen. Its transcript stays readable; its composer must not.
  const [ended, setEnded] = useState(false);

  // Stream turns directly from the same-origin Eve mount (withEve). The hook owns
  // the durable Eve session, so follow-up turns continue the same conversation
  // without a Tendnote chat transcript (ADR 0030). Durable product state still
  // lives in source records, memories, and follow-ups (ADR 0029). A thread the
  // owner reopened rewinds that same durable stream from event 0 rather than
  // replaying a Tendnote copy, which is why resume needs only the id.
  const agent = useEveAgent({
    ...(initialSessionId
      ? { initialSession: { sessionId: initialSessionId, streamIndex: 0 }, resume: true }
      : {}),
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
