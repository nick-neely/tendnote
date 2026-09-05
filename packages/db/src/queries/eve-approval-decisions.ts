import { eveApprovalModeSchema } from "@tendnote/domain";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../client";
import {
  EVE_APPROVAL_DECISION_OUTCOMES,
  EVE_APPROVAL_DECISION_SETTLED_OUTCOMES,
  EVE_APPROVAL_DECISION_TIERS,
  type EveApprovalDecisionSettledOutcome,
  eveApprovalDecisions,
} from "../schema";
import { EVE_SESSION_TOOL_TRUST_TOOL_NAME_MAX_LENGTH } from "./eve-session-tool-trusts";

/**
 * The approval decision record: one audit row per gated Eve tool call (#549).
 *
 * Written from the approval policy seam for every gated call, whatever the
 * policy decided, so that "why did Eve save that without asking" and "why did it
 * ask me again" both have an answer that does not depend on reconstructing the
 * Approval Mode and the taint after the fact.
 *
 * These writes are best-effort at the *call site*: the policy wraps them and a
 * failed audit write must never fail a turn. The functions here therefore stay
 * ordinary - they reject like any other query, and the caller owns the swallow.
 * Making them swallow internally would hide a broken audit trail from every
 * caller at once.
 *
 * Nothing reads these rows on an owner-facing path (see the schema comment).
 */

/** The longest identifier this record will store for a session, turn, or call. */
export const EVE_APPROVAL_DECISION_ID_MAX_LENGTH = 200;

const identifierSchema = z.string().trim().min(1).max(EVE_APPROVAL_DECISION_ID_MAX_LENGTH);

/**
 * The shape the agent side hands the policy seam. Exported so the tier, the
 * outcome vocabulary, and the identifier bounds are one definition rather than a
 * copy on each side of the package boundary.
 */
export const eveApprovalDecisionInputSchema = z.object({
  sessionId: identifierSchema,
  turnId: identifierSchema,
  callId: identifierSchema,
  toolName: z.string().trim().min(1).max(EVE_SESSION_TOOL_TRUST_TOOL_NAME_MAX_LENGTH),
  /** Which side of the Approval Mode line this call fell on. */
  tier: z.enum(EVE_APPROVAL_DECISION_TIERS),
  /** The Approval Mode actually read at decision time, not the one now. */
  modeAtDecision: eveApprovalModeSchema,
  /** Whether the conversation was a Tainted Conversation at decision time. */
  tainted: z.boolean(),
  outcome: z.enum(EVE_APPROVAL_DECISION_OUTCOMES),
});

export type EveApprovalDecisionInput = z.infer<typeof eveApprovalDecisionInputSchema>;

export const eveApprovalDecisionSettledOutcomeSchema = z.enum(
  EVE_APPROVAL_DECISION_SETTLED_OUTCOMES,
);

export type {
  EveApprovalDecisionOutcome,
  EveApprovalDecisionSettledOutcome,
  EveApprovalDecisionTier,
} from "../schema";

/**
 * Record what the policy did with one gated call.
 *
 * One eve call id decides once: a repeat conflicts on (session_id, call_id) and
 * does nothing, so a retried policy evaluation cannot fork the audit trail into
 * two different answers for the same call.
 */
export async function recordEveApprovalDecision(
  input: EveApprovalDecisionInput,
): Promise<{ recorded: boolean }> {
  const decision = eveApprovalDecisionInputSchema.parse(input);

  const rows = await getDb()
    .insert(eveApprovalDecisions)
    .values(decision)
    .onConflictDoNothing({
      target: [eveApprovalDecisions.sessionId, eveApprovalDecisions.callId],
    })
    .returning({ id: eveApprovalDecisions.id });

  return { recorded: rows.length > 0 };
}

/**
 * Record how a parked call ended, against the row `recordEveApprovalDecision`
 * already wrote.
 *
 * `settled_outcome is null` in the `WHERE` clause makes the first settlement the
 * one that sticks: an owner's click and a later cancel of the same request
 * cannot overwrite each other, and a replayed `approval.settled` hook is a
 * no-op. A call with no recorded decision settles nothing and says so.
 */
export async function settleEveApprovalDecision(input: {
  sessionId: string;
  callId: string;
  settledOutcome: EveApprovalDecisionSettledOutcome;
}): Promise<{ settled: boolean }> {
  const sessionId = identifierSchema.parse(input.sessionId);
  const callId = identifierSchema.parse(input.callId);
  const settledOutcome = eveApprovalDecisionSettledOutcomeSchema.parse(input.settledOutcome);

  const rows = await getDb()
    .update(eveApprovalDecisions)
    .set({ settledOutcome, settledAt: new Date() })
    .where(
      and(
        eq(eveApprovalDecisions.sessionId, sessionId),
        eq(eveApprovalDecisions.callId, callId),
        isNull(eveApprovalDecisions.settledOutcome),
      ),
    )
    .returning({ id: eveApprovalDecisions.id });

  return { settled: rows.length > 0 };
}
