/**
 * Live verification that one gated Eve tool call decides once and settles once,
 * run by hand against the disposable dev database.
 *
 * Not a unit test and deliberately not in the suite: both guarantees are clauses
 * Postgres enforces, not JavaScript. `recordEveApprovalDecision` leans on the
 * unique index over (session_id, call_id) to make a retried policy evaluation a
 * no-op, and `settleEveApprovalDecision` leans on `settled_outcome is null` in
 * its `WHERE` to make the first settlement the one that sticks - so an owner's
 * click and a later cancel of the same request cannot overwrite each other, and
 * a replayed `approval.settled` hook changes nothing. A pure-function test can
 * only assert that the query was built; this asks the database what happened.
 *
 *   pnpm --filter @tendnote/db db:eve-approval-decisions:check
 *
 * The table has no owner foreign key by design (see the schema comment), so this
 * needs no seeded account. It removes the rows it made on the way out.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { check, reportLiveCheckResult } from "./live-check";
import {
  type EveApprovalDecisionInput,
  recordEveApprovalDecision,
  settleEveApprovalDecision,
} from "./queries/eve-approval-decisions";
import { eveApprovalDecisions } from "./schema";

async function decisionRows(sessionId: string) {
  return getDb()
    .select()
    .from(eveApprovalDecisions)
    .where(eq(eveApprovalDecisions.sessionId, sessionId));
}

// fallow-ignore-next-line complexity -- The whole point of this script is one uninterrupted narrative against a real Postgres: record, conflict, settle, replay. Its complexity is a run of independent assertions about the same row, and its CRAP score is the absence of the unit coverage the file exists to do without.
async function main() {
  const sessionId = `wrun_live_${randomUUID()}`;
  const callId = `call_${randomUUID()}`;
  const db = getDb();

  const parked: EveApprovalDecisionInput = {
    sessionId,
    turnId: `turn_${randomUUID()}`,
    callId,
    toolName: "capture_memory",
    tier: "reversible_private",
    modeAtDecision: "ask",
    tainted: false,
    outcome: "parked",
  };

  try {
    console.log("\nthe policy's first write lands:");
    check("the decision is recorded", (await recordEveApprovalDecision(parked)).recorded === true);
    const [row] = await decisionRows(sessionId);
    check(
      "with the tier, the mode read, the taint, and the outcome",
      row?.tier === "reversible_private" &&
        row?.modeAtDecision === "ask" &&
        row?.tainted === false &&
        row?.outcome === "parked" &&
        row?.settledOutcome === null,
      row,
    );

    console.log("\na second evaluation of the same call conflicts and does nothing:");
    check(
      "the repeat answers not recorded",
      (
        await recordEveApprovalDecision({
          ...parked,
          // A different answer for the same call is exactly what must not fork the
          // audit trail into two rows.
          modeAtDecision: "trusted",
          outcome: "auto_approved",
        })
      ).recorded === false,
    );
    check("and there is still exactly one row", (await decisionRows(sessionId)).length === 1);
    const [afterConflict] = await decisionRows(sessionId);
    check(
      "whose original answer is untouched",
      afterConflict?.modeAtDecision === "ask" && afterConflict?.outcome === "parked",
      afterConflict,
    );

    console.log("\nthe first settlement wins:");
    check(
      "the owner's answer settles the row",
      (await settleEveApprovalDecision({ sessionId, callId, settledOutcome: "allowed" }))
        .settled === true,
    );
    const [settled] = await decisionRows(sessionId);
    check(
      "the row records it, with a settled time",
      settled?.settledOutcome === "allowed" && settled?.settledAt !== null,
      settled,
    );

    console.log("\nand a second settlement is a no-op, not an overwrite:");
    check(
      "a later cancel of the same request settles nothing",
      (await settleEveApprovalDecision({ sessionId, callId, settledOutcome: "cancelled" }))
        .settled === false,
    );
    const [afterReplay] = await decisionRows(sessionId);
    check(
      "the first answer and its time both stand",
      afterReplay?.settledOutcome === "allowed" &&
        afterReplay?.settledAt?.getTime() === settled?.settledAt?.getTime(),
      afterReplay,
    );

    console.log("\na call nobody recorded settles nothing:");
    check(
      "an unknown call id answers not settled",
      (
        await settleEveApprovalDecision({
          sessionId,
          callId: `call_${randomUUID()}`,
          settledOutcome: "allowed",
        })
      ).settled === false,
    );
    check(
      "and no row was invented for it",
      (await decisionRows(sessionId)).length === 1,
      await decisionRows(sessionId),
    );
    check(
      "an unknown session leaves the recorded call alone",
      (
        await settleEveApprovalDecision({
          sessionId: `wrun_live_${randomUUID()}`,
          callId,
          settledOutcome: "cancelled",
        })
      ).settled === false,
    );
  } finally {
    // Nothing cascades onto this table: it is deliberately owner-key free, so it
    // cleans up after itself.
    await db.delete(eveApprovalDecisions).where(eq(eveApprovalDecisions.sessionId, sessionId));
  }

  reportLiveCheckResult();
}

void main();
