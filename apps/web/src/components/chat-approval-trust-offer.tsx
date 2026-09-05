"use client";

import { isReversiblePrivateWriteRequest } from "@tendnote/domain/eve-approvals";
import { useId } from "react";
import { useAssistantApprovalPolicy } from "@/components/assistant-approval-policy-context";
import type { ApprovalDecisions } from "@/components/chat-approval-decisions";
import { useSessionToolTrust } from "@/components/session-tool-trust-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { approveOptionId } from "@/lib/eve/approval-answers";
import type { AssistantInputRequestView } from "@/lib/eve/input-request-view";

/**
 * The Session Tool Trust offer, in the owner's own words rather than the policy's.
 *
 * The parenthesis is not a caveat, it is the whole limit: a trust is honoured only
 * for a Reversible Private Write, so on a card asking to send, share, delete, or
 * fetch, ticking it changes nothing about the next such request. Without the words
 * the checkbox promises a quiet that those calls will never deliver.
 */
const REMEMBER_TOOL_LABEL =
  "Don't ask again for this in this conversation (reversible private saves only)";

/**
 * The offer to stop asking about this one tool for the rest of this conversation.
 *
 * Unticked by default and never remembered across conversations: a Session Tool
 * Trust is scoped to the session and the tool name, and it is not an approval - the
 * click beside it still is.
 *
 * It is withheld whenever the agent would not honour it, because a control that
 * changes nothing is worse than no control at all:
 *
 * - a question authorizes nothing, and a request with no affirmative option has no
 *   approval to ride on;
 * - a Tainted Conversation makes the policy ignore every trust in it;
 * - and the trust applies only to a Reversible Private Write. `web_fetch` leaves
 *   the process and `save_draft_to_gmail` cannot be taken back, so both ask every
 *   time whatever is ticked. That tier is read from the shared list in
 *   `@tendnote/domain/eve-approvals`, whose agreement with the tools' own
 *   declarations is enforced in `apps/agent/tests/write-tool-approval.test.ts`.
 *   The frozen input goes with the name because one tool's tier depends on it:
 *   a `capture_saved_item` that names a `requestedScope` is asking to widen its
 *   audience, and always asks.
 */
export function ApprovalTrustCheckbox({
  decisions,
  locked,
  request,
}: {
  decisions: ApprovalDecisions;
  locked: boolean;
  request: AssistantInputRequestView;
}) {
  const { isTaintedBefore } = useAssistantApprovalPolicy();
  const { sessionId } = useSessionToolTrust();
  const inputId = useId();

  const offered =
    request.kind === "tool-approval" &&
    sessionId !== null &&
    approveOptionId(request) !== null &&
    isReversiblePrivateWriteRequest(request.toolName, request.input) &&
    !isTaintedBefore(request.toolCallId);

  if (!offered) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={decisions.remembered.has(request.toolCallId)}
        disabled={locked}
        id={inputId}
        onCheckedChange={(checked) => decisions.setRemembered(request.toolCallId, checked === true)}
      />
      <Label
        className="font-normal text-[length:var(--text-caption)] text-muted-foreground"
        htmlFor={inputId}
      >
        {REMEMBER_TOOL_LABEL}
      </Label>
    </div>
  );
}
