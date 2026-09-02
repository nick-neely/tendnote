"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * The one way a chat card answers a parked Eve turn.
 *
 * Every other interactive card in the conversation calls an ordinary owner-scoped
 * server action on independent domain state. An approval is different: the turn
 * itself is durably waiting, and only the live `useEveAgent` session can resume it.
 * The panel owns that session (there is exactly one `useEveAgent` in the app, in
 * `assistant-panel.tsx`), so it hands its `respond` down here rather than letting a
 * card mint a second session — two sessions would each hold their own durable
 * cursor, and the card would answer a turn nobody is waiting on.
 */

/** One answer to a parked request: the id Eve asked for, plus what the owner chose. */
export type AssistantInputResponse = {
  readonly requestId: string;
  readonly optionId?: string;
  readonly text?: string;
};

export type AssistantRespondValue = {
  /** Resumes the parked turn. Structurally `useEveAgent().respond`. */
  readonly respond: (responses: readonly AssistantInputResponse[]) => Promise<void>;
  /**
   * Whether eve will accept an answer right now. A parked turn leaves the session
   * idle, so `ready` is true exactly while nothing else is in flight — which also
   * serializes the cards: answering one takes the session, and every other pending
   * card in the transcript disables itself until that response settles.
   */
  readonly ready: boolean;
};

/**
 * Read-only fallback. A card rendered outside a live panel (a reserve, a story, a
 * test that only checks copy) shows its request with the actions disabled rather
 * than crashing the transcript — and cannot answer, because `ready` is false.
 */
const DISCONNECTED: AssistantRespondValue = {
  respond: () => Promise.reject(new Error("No live Eve session is connected to this panel.")),
  ready: false,
};

const AssistantRespondContext = createContext<AssistantRespondValue>(DISCONNECTED);

export function AssistantRespondProvider({
  children,
  ready,
  respond,
}: {
  children: ReactNode;
  ready: boolean;
  respond: AssistantRespondValue["respond"];
}) {
  const value = useMemo<AssistantRespondValue>(() => ({ ready, respond }), [ready, respond]);
  return (
    <AssistantRespondContext.Provider value={value}>{children}</AssistantRespondContext.Provider>
  );
}

export function useAssistantRespond(): AssistantRespondValue {
  return useContext(AssistantRespondContext);
}
