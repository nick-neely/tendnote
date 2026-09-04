"use client";

import { useAssistantApprovalPolicy } from "@/components/assistant-approval-policy-context";
import type { AssistantInputRequestView } from "@/lib/eve/input-request-view";

/**
 * Why an owner in `trusted` Approval Mode is being asked at all.
 *
 * Reading a page or a search result makes this a Tainted Conversation, and from
 * that point the policy behaves as `ask` whatever the owner chose. Without a word
 * about it the card looks like the setting was ignored. The sentence is derived
 * client-side and is *only* a sentence: it never touches which options the card
 * offers or what it sends.
 *
 * "The assistant", not "Eve": the framework is never named in owner-facing copy
 * (DESIGN.md §6).
 */
const TAINT_EXPLANATION =
  "The assistant asked because web content was read in this conversation. Start a new conversation to resume automatic saves.";

/**
 * Why this card exists at all, when the owner already chose `trusted`.
 *
 * Shown only when both halves hold: the owner's Approval Mode is `trusted`, and web
 * content was read in this conversation before the call being asked about. Both are
 * client-side readings of what the agent decided authoritatively, so this is an
 * explanation and never a claim about what will happen - the options, the payload,
 * and the answer are identical with or without it.
 */
export function ApprovalTaintNote({
  requests,
}: {
  requests: readonly AssistantInputRequestView[];
}) {
  const { approvalMode, isTaintedBefore } = useAssistantApprovalPolicy();

  const explains =
    approvalMode === "trusted" &&
    requests.some(
      (request) => request.kind === "tool-approval" && isTaintedBefore(request.toolCallId),
    );

  return explains ? (
    <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
      {TAINT_EXPLANATION}
    </p>
  ) : null;
}
