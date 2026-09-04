"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * Where an approval card records a Session Tool Trust.
 *
 * A Session Tool Trust is the owner's choice, made on the card as they approve,
 * that one named tool may run its Reversible Private Writes without asking again
 * for the rest of *this* conversation. It is scoped to the conversation and the
 * tool name — never to an input, never beyond the conversation — and the agent
 * ignores it entirely in a Tainted Conversation, which is why the card hides the
 * checkbox there rather than writing a row that would never be honoured.
 *
 * The write itself is an owner-scoped server action, and this slice deliberately
 * does not own it: the default is a no-op, so the checkbox is inert until the
 * sibling slice provides the real recorder here. That keeps one seam — this
 * context — rather than a server action reached from inside a card, which is the
 * shape every other approval-adjacent write in the panel already avoids.
 *
 * Recording is best effort by construction: it happens *after* an approval that
 * already went through, so a failure loses a convenience and never a decision.
 */

/** One remembered tool, in the scope the trust is keyed by. */
export type SessionToolTrustRequest = {
  /** The Eve session the trust belongs to. Null while no session exists yet. */
  readonly sessionId: string;
  readonly toolName: string;
};

export type RecordSessionToolTrust = (request: SessionToolTrustRequest) => Promise<void>;

export type SessionToolTrustValue = {
  /** The live conversation, or null before eve has minted one. */
  readonly sessionId: string | null;
  readonly recordSessionToolTrust: RecordSessionToolTrust;
};

/** No session, and nowhere to write: a card outside a live panel offers no trust. */
const DISCONNECTED: SessionToolTrustValue = {
  recordSessionToolTrust: () => Promise.resolve(),
  sessionId: null,
};

const SessionToolTrustContext = createContext<SessionToolTrustValue>(DISCONNECTED);

export function SessionToolTrustProvider({
  children,
  recordSessionToolTrust = DISCONNECTED.recordSessionToolTrust,
  sessionId,
}: {
  children: ReactNode;
  recordSessionToolTrust?: RecordSessionToolTrust;
  sessionId: string | null;
}) {
  const value = useMemo<SessionToolTrustValue>(
    () => ({ recordSessionToolTrust, sessionId }),
    [recordSessionToolTrust, sessionId],
  );
  return (
    <SessionToolTrustContext.Provider value={value}>{children}</SessionToolTrustContext.Provider>
  );
}

export function useSessionToolTrust(): SessionToolTrustValue {
  return useContext(SessionToolTrustContext);
}
