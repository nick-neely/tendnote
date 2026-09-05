"use client";

import type { EveMessage } from "eve/react";
import { type ReactNode, useCallback, useMemo } from "react";
import { recordSessionToolTrustAction } from "@/app/actions/eve-approvals";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  AssistantApprovalPolicyProvider,
  type EveApprovalMode,
} from "@/components/assistant-approval-policy-context";
import {
  type RecordSessionToolTrust,
  SessionToolTrustProvider,
} from "@/components/session-tool-trust-context";
import { pendingApprovalRequests, typedApprovalAnswer } from "@/lib/eve/approval-answers";
import { webTaintedToolCallIds } from "@/lib/eve/conversation-taint";
import type { AssistantInputRequestView } from "@/lib/eve/input-request-view";

/**
 * Everything the panel knows about the approvals waiting inside its own
 * conversation, in one place.
 *
 * The panel is where these belong - it holds the single `useEveAgent` and so the
 * only `respond` in the app - but they are four derivations of one transcript
 * rather than four things the panel does, and inlining them put the whole of the
 * approval reading inside a component whose other job is the layout. Here they
 * are one seam the panel spreads into providers and the composer.
 */
export type AssistantPanelApprovals = {
  /** The oldest tool approval still waiting on the owner, or null. */
  readonly pendingApproval: AssistantInputRequestView | null;
  /**
   * Whether the transcript had already read web content when this call parked.
   * Explanatory only: the agent derives the same fact authoritatively, and the
   * card uses this to decide whether to say a sentence, never what to send.
   */
  readonly isTaintedBefore: (toolCallId: string) => boolean;
  /**
   * The composer's submit path: a word that answers the oldest waiting approval
   * answers it, and anything else is an ordinary message.
   */
  readonly handleSubmit: (message: PromptInputMessage) => Promise<void>;
  /** Where a ticked "don't ask again" goes. */
  readonly recordSessionToolTrust: RecordSessionToolTrust;
};

export function useAssistantPanelApprovals({
  messages,
  respond,
  submit,
}: {
  messages: readonly EveMessage[];
  respond: (answers: Array<{ requestId: string; optionId: string }>) => Promise<unknown>;
  /** What an ordinary message does: the panel's own send queue. */
  submit: (text: string) => Promise<void> | void;
}): AssistantPanelApprovals {
  // Every tool approval still waiting on the owner, oldest first. Two things read
  // it: the composer, which must not send the word "approve" as a message, and the
  // line under the box that says what sending one would do.
  const pendingApprovals = useMemo(() => pendingApprovalRequests(messages), [messages]);

  /**
   * What Enter does: a typed answer to the oldest waiting approval when that is
   * what this line is, and the send queue otherwise.
   *
   * The framework's own instruction to the model is never to ask anyone to type
   * "approve", but people type it anyway - and eve clears the parked batch when an
   * ordinary message arrives, so the word meant to allow the save is exactly what
   * cancels it. So the composer answers with it instead, and only on an exact match
   * against an option the request itself offers.
   *
   * Rejecting rather than swallowing a failure is deliberate: the composer restores
   * the text it optimistically cleared on a rejection, so a refused response leaves
   * the owner's word back in the box rather than nowhere.
   */
  const handleSubmit = useCallback(
    async (message: PromptInputMessage): Promise<void> => {
      const oldest = pendingApprovals[0];
      const optionId = oldest ? typedApprovalAnswer(oldest, message.text) : null;
      if (oldest && optionId) {
        await respond([{ requestId: oldest.requestId, optionId }]);
        return;
      }
      await submit(message.text);
    },
    [pendingApprovals, respond, submit],
  );

  const taintedCallIds = useMemo(() => webTaintedToolCallIds(messages), [messages]);
  const isTaintedBefore = useCallback(
    (toolCallId: string) => taintedCallIds.has(toolCallId),
    [taintedCallIds],
  );

  /**
   * Where a ticked "don't ask again" goes: the owner-scoped action, which writes
   * only through the session-owner binding.
   *
   * Best effort by construction. It runs after an approval that already went
   * through, so a rejected promise or a `recorded: false` costs a convenience and
   * never a decision - and `false` is the same answer for a session that belongs
   * to somebody else as for one that never existed (ADR 0219), so there is
   * nothing here to tell the owner either way.
   */
  const recordSessionToolTrust = useCallback<RecordSessionToolTrust>(async (request) => {
    await recordSessionToolTrustAction(request).catch(() => {});
  }, []);

  return {
    handleSubmit,
    isTaintedBefore,
    pendingApproval: pendingApprovals[0] ?? null,
    recordSessionToolTrust,
  };
}

/**
 * The two conversation-wide facts an approval card sitting several layers below
 * the panel needs: why it is being asked at all, and where a ticked "don't ask
 * again" goes.
 *
 * One element rather than two nested ones. They are always installed together
 * and over the same subtree, and neither can change what a card sends - so a
 * panel that reads as layout should carry one line for them, not two levels of
 * nesting that happen to be about the same thing.
 */
export function AssistantApprovalProviders({
  approvalMode,
  approvals,
  children,
  sessionId,
}: {
  approvalMode: EveApprovalMode;
  approvals: AssistantPanelApprovals;
  children: ReactNode;
  /** The live conversation, or undefined before eve has minted one. */
  sessionId?: string;
}) {
  return (
    <AssistantApprovalPolicyProvider
      approvalMode={approvalMode}
      isTaintedBefore={approvals.isTaintedBefore}
    >
      <SessionToolTrustProvider
        recordSessionToolTrust={approvals.recordSessionToolTrust}
        sessionId={sessionId ?? null}
      >
        {children}
      </SessionToolTrustProvider>
    </AssistantApprovalPolicyProvider>
  );
}
