"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * The two facts an approval card needs to explain *why it is asking* — and neither
 * of them may change what it sends.
 *
 * The owner's Approval Mode lives on their access profile and is read by the agent's
 * policy on every gated call; the browser's copy of it is a label, never an
 * authority. A Tainted Conversation is likewise derived twice: authoritatively
 * inside the agent, and here from the transcript the panel already has
 * (`lib/eve/conversation-taint.ts`). The one thing the card does with either is
 * decide whether to say a sentence and whether to offer a Session Tool Trust
 * checkbox that would be ignored anyway.
 *
 * Both arrive through context rather than as card props because the cards are
 * rendered by the turn projection, several layers below the panel that knows them,
 * and threading two values through every unit renderer would put the panel's
 * account of the conversation into the signature of every result card.
 */

/**
 * The owner's account-level Approval Mode. Structurally the domain's
 * `eveApprovalMode`; a sibling slice adds the field and the account control, and
 * this seam is where its value arrives (`AssistantPanel`'s `approvalMode` prop).
 */
export type EveApprovalMode = "ask" | "trusted";

export type AssistantApprovalPolicyValue = {
  readonly approvalMode: EveApprovalMode;
  /**
   * Whether web content was read in this conversation *before* the parked call
   * with this id. Explanatory only.
   */
  readonly isTaintedBefore: (toolCallId: string) => boolean;
};

/**
 * What a card assumes when nothing told it otherwise: the cautious mode, and no
 * claim about the conversation. Both are the states in which the card says nothing
 * extra, so a card rendered outside a live panel explains itself the same way it
 * did before any of this existed.
 */
const DEFAULT_POLICY: AssistantApprovalPolicyValue = {
  approvalMode: "ask",
  isTaintedBefore: () => false,
};

const AssistantApprovalPolicyContext = createContext<AssistantApprovalPolicyValue>(DEFAULT_POLICY);

export function AssistantApprovalPolicyProvider({
  approvalMode,
  children,
  isTaintedBefore,
}: {
  approvalMode: EveApprovalMode;
  children: ReactNode;
  isTaintedBefore: (toolCallId: string) => boolean;
}) {
  const value = useMemo<AssistantApprovalPolicyValue>(
    () => ({ approvalMode, isTaintedBefore }),
    [approvalMode, isTaintedBefore],
  );
  return (
    <AssistantApprovalPolicyContext.Provider value={value}>
      {children}
    </AssistantApprovalPolicyContext.Provider>
  );
}

export function useAssistantApprovalPolicy(): AssistantApprovalPolicyValue {
  return useContext(AssistantApprovalPolicyContext);
}
