import type { HouseholdRecordProver } from "../households/authorization";
import { reminderSubscriber } from "./policy";
import type { ReminderRecord } from "./types";

/** The one thing authorizing a subscription needs from the Household boundary. */
export type ReminderRecordProver = Pick<HouseholdRecordProver, "proveRecordAccess">;

/**
 * Whether a member may hold their own Reminder Schedule for a record.
 *
 * `reminder_schedules` is keyed on the subscribing member and the record, so
 * several members can each be reminded about one shared Routine and both
 * partners can hear about bin day. What the key cannot decide is whether a given
 * member is *entitled* to one, and that is deliberately not owner-equality any
 * more: it is the Household Authorization Proof, asked for `progress`, the same
 * authority that lets a member complete the record they are asking to be
 * reminded about (ADR 0203, ADR 0219).
 *
 * Nothing here enrolls anybody. This authorizes a member's own explicit choice
 * about their own devices; no other member's action ever reaches it.
 *
 * Asked twice for every alert, and the second time is the one that matters: once
 * when the member subscribes, and again inside dispatch immediately before the
 * send, against a record reloaded at that moment. Someone who left the household
 * this morning is refused tonight's bin-day alert here even though their
 * schedule, intent, and queued job were all written while they still belonged.
 *
 * Takes its prover rather than reaching for one, so the composition root and the
 * isolation matrix authorize through the same function instead of two copies of
 * it that can drift into disagreeing about who may be reminded.
 */
export function createReminderSubscriptionAuthorizer(prover: ReminderRecordProver) {
  return async function authorizeReminderSubscription(input: {
    subscriberUserId: string;
    record: ReminderRecord;
  }): Promise<boolean> {
    if (input.record.kind !== "general_action" && input.record.kind !== "routine") {
      // Through `reminderSubscriber` rather than the owner directly: a
      // visibility-keyed loader names the member it proved the record for, and a
      // workspace-owned record has no owner to compare against at all (ADR 0214).
      //
      // This is an identity check and not a second proof on purpose. The
      // families that reach it are the ones whose *loader* is the proof - a
      // Saved Item resolves through `getVisibleSavedItem`, a Follow-Up through
      // an owner-keyed read that only its owner can ever satisfy - so a
      // subscriber who has lost standing arrives here with no record at all and
      // dispatch has already decided to suppress. Proving again from a record
      // that was only produced by proving would add a step, not a check.
      return reminderSubscriber(input.record) === input.subscriberUserId;
    }
    const proof = await prover.proveRecordAccess({
      callerUserId: input.subscriberUserId,
      operation: "progress",
      record: {
        kind: "general_action",
        id: input.record.id,
        ownerUserId: input.record.ownerUserId,
        scope: input.record.scope,
        householdId: input.record.householdId ?? null,
        ownership: input.record.ownership ?? "member_owned",
      },
    });
    return proof.authorized;
  };
}
