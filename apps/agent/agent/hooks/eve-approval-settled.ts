import { settleEveApprovalDecision } from "@tendnote/db/queries/eve-approval-decisions";
import { defineHook } from "eve/hooks";
import { APPROVAL_REQUEST_KIND } from "../lib/approval/contract";

/**
 * Records how a parked Owner Approval ended, against the decision row the policy
 * seam already wrote (ADR-0240).
 *
 * ## Why two events
 *
 * The decision record is keyed by call id, because that is what the policy has:
 * eve builds the `InputRequest` - and its `requestId` - only after the policy has
 * already returned `user-approval`. `approval.settled` then carries the
 * `requestId` and nothing else identifying, so neither event alone can settle a
 * row. `input.requested` is where the two identifiers appear together, on
 * `requests[].requestId` and `requests[].action.callId`, so this hook remembers
 * that pairing and spends it when the settlement arrives.
 *
 * The map is in-process and bounded. A restart between the request and the
 * answer loses the pairing and the row simply stays unsettled, which is the
 * right failure for a best-effort audit trail: a settlement that cannot be
 * attributed to a call is worth less than an honest gap. Nothing reads these
 * rows on an owner-facing path, so a gap costs nobody a decision.
 *
 * Like every hook here, the write is swallowed: hooks are observe-only and the
 * durable event is already recorded.
 */

/**
 * How many unanswered approval requests one process remembers.
 *
 * An owner answers or abandons a card in the same session; a batch is a handful
 * of calls. The bound exists so a long-lived process that accumulates abandoned
 * requests cannot grow without limit, and evicting the oldest is right because
 * an unanswered request only gets less likely to be answered.
 */
const MAX_REMEMBERED_APPROVAL_REQUESTS = 200;

export const createEveApprovalSettledHook = (
  settle: typeof settleEveApprovalDecision = settleEveApprovalDecision,
) => {
  const callIdByRequestId = new Map<string, string>();

  return defineHook({
    events: {
      "input.requested"(event) {
        for (const request of event.data.requests ?? []) {
          if (request.kind !== APPROVAL_REQUEST_KIND) continue;

          const requestId = request.requestId;
          const callId = request.action?.callId;
          if (!requestId || !callId) continue;

          if (callIdByRequestId.size >= MAX_REMEMBERED_APPROVAL_REQUESTS) {
            const oldest = callIdByRequestId.keys().next();
            if (oldest.done !== true) callIdByRequestId.delete(oldest.value);
          }
          callIdByRequestId.set(requestId, callId);
        }
      },

      async "approval.settled"(event, ctx) {
        const callId = callIdByRequestId.get(event.data.requestId);
        if (callId === undefined) return;
        callIdByRequestId.delete(event.data.requestId);

        try {
          await settle({
            sessionId: ctx.session.id,
            callId,
            // eve's two terminal outcomes, in this record's vocabulary: the owner
            // let the call run, or the call never ran.
            settledOutcome: event.data.outcome === "approved" ? "allowed" : "cancelled",
          });
        } catch {
          // Best-effort: a failed audit write never fails a turn.
        }
      },
    },
  });
};

export default createEveApprovalSettledHook();
