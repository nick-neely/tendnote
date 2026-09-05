"use client";

import { useState } from "react";
import { useAssistantRespond } from "@/components/assistant-respond-context";
import { useSessionToolTrust } from "@/components/session-tool-trust-context";
import { APPROVE_OPTION_ID } from "@/lib/eve/approval-answers";
import type { AssistantInputRequestView } from "@/lib/eve/input-request-view";

/**
 * The answering half of an approval card: what is on the wire, what has already
 * been sent, and which Session Tool Trusts ride along with it.
 *
 * Split from the cards themselves because both of them hold exactly one of these
 * and nothing else shares it - the single card, the batch card, and every item on
 * either. Keeping it here is what lets `chat-approval-card.tsx` be about layout
 * and copy while this file is about the round trip.
 */

/** Identity for the freeform answer in `sending`; no option id can collide with it. */
export const FREEFORM_KEY = " freeform";

/** Identity for the batch card's own control, which belongs to no single item. */
export const APPROVE_ALL_KEY = " approve-all";

/** One answer, kept beside the request it answers so the card can settle both. */
export type ApprovalSubmission = {
  readonly request: AssistantInputRequestView;
  readonly response: { optionId?: string; text?: string };
};

/** How one item's control posts an answer back: the control's own key, and eve's payload. */
export type ItemAnswerHandler = (
  control: string,
  response: { optionId?: string; text?: string },
) => Promise<void>;

/**
 * Everything a card holds while its decisions are being made, shared by every item
 * on it.
 *
 * It is card-scoped rather than item-scoped because eve is: a response takes the
 * whole session, so exactly one answer can be on the wire at a time and a batch that
 * let two items send at once would simply produce an error on the second. One
 * `sending` key, one failure line, and one lock is the honest model of that.
 *
 * `answered` is the card's own short memory of what it just sent. The reducer flips a
 * part to `approval-responded` a moment later and the item leaves the batch on its
 * own, but until it does, an item whose answer already went out must not offer to
 * send a second one - and "Approve all" must not re-answer it.
 */
export type ApprovalDecisions = {
  readonly answer: (key: string, submissions: readonly ApprovalSubmission[]) => Promise<void>;
  /** Call ids this card has already answered, before the stream has caught up. */
  readonly answered: ReadonlySet<string>;
  readonly failure: string | null;
  readonly locked: boolean;
  /** Call ids whose Session Tool Trust checkbox is ticked. */
  readonly remembered: ReadonlySet<string>;
  /** The key of the control whose answer is on the wire, or null. */
  readonly sending: string | null;
  readonly setRemembered: (toolCallId: string, remember: boolean) => void;
};

export function useApprovalDecisions(): ApprovalDecisions {
  const { ready, respond } = useAssistantRespond();
  const { recordSessionToolTrust, sessionId } = useSessionToolTrust();
  const [sending, setSending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [remembered, setRemembered] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * The trust the owner ticked, recorded only once the approval it rode on actually
   * went through - and only for the affirmative option, looked up on the request
   * rather than assumed. Best effort by construction: the decision is already made,
   * so a failed write costs a convenience and never an approval.
   */
  function recordTickedTrust(submissions: readonly ApprovalSubmission[]): void {
    if (sessionId === null) {
      return;
    }
    for (const { request, response } of submissions) {
      if (response.optionId !== APPROVE_OPTION_ID || !remembered.has(request.toolCallId)) {
        continue;
      }
      void recordSessionToolTrust({ sessionId, toolName: request.toolName }).catch(() => {});
    }
  }

  async function answer(key: string, submissions: readonly ApprovalSubmission[]): Promise<void> {
    setSending(key);
    setFailure(null);
    try {
      // One `respond`, whether that is one item's button or the whole batch: eve
      // settles the parked requests it names together.
      await respond(
        submissions.map(({ request, response }) => ({
          requestId: request.requestId,
          ...response,
        })),
      );
      setAnswered(
        (prior) => new Set([...prior, ...submissions.map((it) => it.request.toolCallId)]),
      );
      recordTickedTrust(submissions);
    } catch {
      setFailure("That didn't go through. Try again, or answer in the message box below.");
    } finally {
      setSending(null);
    }
  }

  return {
    answer,
    answered,
    failure,
    // Answering takes the whole session - eve refuses a response while any turn is in
    // flight - so a second pending card in the transcript is disabled by `ready` until
    // this one settles, rather than racing it into an error.
    locked: sending !== null || !ready,
    remembered,
    sending,
    setRemembered: (toolCallId, remember) =>
      setRemembered((prior) => {
        const next = new Set(prior);
        if (remember) {
          next.add(toolCallId);
        } else {
          next.delete(toolCallId);
        }
        return next;
      }),
  };
}
