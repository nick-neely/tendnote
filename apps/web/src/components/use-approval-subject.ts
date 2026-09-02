"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { describeApprovalSubjectAction } from "@/app/actions/approval-subjects";
import {
  APPROVAL_SUBJECT_MISSING,
  APPROVAL_SUBJECT_UNDESCRIBED,
  type ApprovalSubjectState,
  claimApprovalSubjectLookup,
  readApprovalSubject,
  settleApprovalSubject,
  subscribeApprovalSubject,
} from "@/lib/approval-subject-cache";
import type { AssistantInputRequestView } from "@/lib/eve/input-request-view";

/**
 * The owner-legible account of a tool call Eve parked, fetched once per call.
 *
 * eve 0.47.7 hands the browser a fixed prompt and the frozen tool input, and nothing
 * else — so `accept_suggested_followup` arrives as a tool name and a UUID. Turning
 * that id back into the record it names needs an owner-scoped read, which only the
 * server can do, so the card asks for one.
 *
 * These hooks are the reading end; the answers live in
 * `@/lib/approval-subject-cache`, outside the tree, so the settled status line can
 * reuse what the pending card resolved. See that module for why.
 */

/**
 * The lookup's answer, or no claim.
 *
 * A refused request is `missing` — the action's own validation and the registry's
 * both mean "there is no subject here to show you". A *thrown* call is different:
 * the network dropped or the session ended, which says nothing about the record, so
 * telling the owner it is unavailable would be a sentence the card cannot support.
 * That degrades to `undescribed` and the raw input stands on its own.
 */
function startLookup(toolCallId: string, toolName: string, input: unknown): void {
  if (!claimApprovalSubjectLookup(toolCallId)) return;

  void describeApprovalSubjectAction({ toolName, input })
    .then((result) => {
      if (!result.ok) return settleApprovalSubject(toolCallId, APPROVAL_SUBJECT_MISSING);
      if (result.view.kind === "described") {
        return settleApprovalSubject(toolCallId, {
          status: "described",
          subject: result.view.subject,
        });
      }
      return settleApprovalSubject(
        toolCallId,
        result.view.kind === "missing" ? APPROVAL_SUBJECT_MISSING : APPROVAL_SUBJECT_UNDESCRIBED,
      );
    })
    .catch(() => settleApprovalSubject(toolCallId, APPROVAL_SUBJECT_UNDESCRIBED));
}

function useApprovalSubjectState(toolCallId: string | null): ApprovalSubjectState {
  const subscribeToCall = useCallback(
    (listener: () => void) =>
      toolCallId === null ? () => {} : subscribeApprovalSubject(toolCallId, listener),
    [toolCallId],
  );
  const snapshot = useCallback(
    () => (toolCallId === null ? APPROVAL_SUBJECT_UNDESCRIBED : readApprovalSubject(toolCallId)),
    [toolCallId],
  );

  return useSyncExternalStore(subscribeToCall, snapshot, snapshot);
}

/**
 * Describes a parked request, starting the lookup the first time the call is seen.
 *
 * Only a `tool-approval` is described: a `question` is the model's own words to the
 * owner and refers to no record, so asking about it would be a request the registry
 * could only answer `unknown-tool`. That is the one exclusion the client can make
 * cheaply and correctly; every other tool is asked about and an `unknown-tool`
 * answer costs the card nothing.
 */
export function useApprovalSubject(request: AssistantInputRequestView): ApprovalSubjectState {
  const { input, kind, toolCallId, toolName } = request;
  const describable = kind === "tool-approval";

  useEffect(() => {
    if (!describable) return;
    // Re-running is free: the store, not this dependency array, is what makes the
    // lookup happen once — so a new `input` object identity each render cannot
    // turn into a second read of the owner's records.
    startLookup(toolCallId, toolName, input);
  }, [describable, input, toolCallId, toolName]);

  return useApprovalSubjectState(describable ? toolCallId : null);
}

/**
 * The title already resolved for a settled call, if the card's lookup landed.
 *
 * Read-only on purpose: once the decision is made there is nothing left to describe,
 * so a status line that arrived after a page reload keeps its plain tool-and-argument
 * summary rather than spending an owner-scoped read on history.
 */
export function useApprovalSubjectTitle(toolCallId: string): string | null {
  const state = useApprovalSubjectState(toolCallId);
  return state.status === "described" ? state.subject.title : null;
}
