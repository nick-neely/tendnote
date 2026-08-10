import { reminderTimeSemanticsForRecordKind } from "@tendnote/domain/reminders";
import type { FollowupStore } from "../followups/types";
import type { GeneralActionStore } from "../general-actions/types";
import type { SavedItemStore } from "../saved-items/types";
import type { SourceRecordCaptureStore } from "../source-records/types";
import type { ReminderRecord } from "./types";

/**
 * The reads a reminder needs to answer "what is this record, for this member,
 * right now?" - and nothing else.
 *
 * Structural rather than the concrete stores, so the isolation matrix can drive
 * these exact loaders against in-memory stores. That matters more here than
 * anywhere else in the reminder stack: a loader is where a departed member's
 * record stops existing, so a test that reimplements one is testing its own
 * reimplementation of the thing that revokes access.
 */
export type ReminderRecordStores = {
  actionStore: Pick<GeneralActionStore, "getGeneralAction" | "getVisibleGeneralAction">;
  followupStore: Pick<FollowupStore, "getFollowup">;
  savedItemStore: Pick<SavedItemStore, "getVisibleSavedItem">;
  sourceRecordStore: Pick<SourceRecordCaptureStore, "getSourceRecord" | "getVisibleSourceRecord">;
};

/**
 * The one place a reminder turns a stored id back into a record.
 *
 * Called at subscription time and again inside dispatch immediately before the
 * send, against whatever the record is at that moment. Every kind's loader is
 * keyed so that a member who has lost standing simply loads nothing, which is
 * what makes revocation a property of the read rather than of a sweep that has
 * to have run first.
 */
export function createReminderRecordLoader(stores: ReminderRecordStores) {
  async function reminderSourceSensitivity(input: {
    ownerUserId: string;
    sourceRecordId: string | null;
    getSourceRecord: (input: {
      ownerUserId: string;
      sourceRecordId: string;
    }) => Promise<{ sensitivity: "normal" | "sensitive" | "restricted" } | null>;
  }) {
    if (!input.sourceRecordId) return "normal" as const;
    return (
      (
        await input.getSourceRecord({
          ownerUserId: input.ownerUserId,
          sourceRecordId: input.sourceRecordId,
        })
      )?.sensitivity ?? "restricted"
    );
  }

  async function loadFollowupReminderRecord(input: {
    ownerUserId: string;
    recordId: string;
  }): Promise<ReminderRecord | null> {
    const followup = await stores.followupStore.getFollowup({
      ownerUserId: input.ownerUserId,
      followupId: input.recordId,
    });
    if (!followup) return null;
    const sensitivity = await reminderSourceSensitivity({
      ownerUserId: input.ownerUserId,
      sourceRecordId: followup.sourceRecordId ?? null,
      getSourceRecord: stores.sourceRecordStore.getSourceRecord,
    });
    return {
      id: followup.id,
      kind: "follow_up",
      ownerUserId: followup.ownerUserId,
      title: followup.reason,
      status: followup.status,
      occursAt: followup.dueAt,
      timeSemantics: reminderTimeSemanticsForRecordKind("follow_up"),
      recurrence: null,
      sensitivity,
      scope: followup.scope,
      personId: followup.personId,
    };
  }

  /**
   * The one loader keyed by visibility rather than by ownership.
   *
   * Every active member who can currently see a Saved Item may choose their own
   * Reminder Schedule for it, and a household-native one has no owner to key on at
   * all (`docs/phase-8/household-saved-items.md`, ADR 0214). An owner-scoped read
   * here would answer null for exactly the two cases that clause exists to serve -
   * a workspace-owned item, and another member's item shared with this member -
   * and the surface would render a reminder control that silently did nothing.
   *
   * `getVisibleSavedItem` runs the Household Authorization Proof, so this asks the
   * precise question a subscription depends on: may this member see this record,
   * right now? A member who has since left, or lost the share, loads nothing - and
   * because dispatch loads through here too, their pending intents stop being
   * deliverable at the same moment, without relying on a separate sweep.
   */
  async function loadSavedItemReminderRecord(input: {
    subscriberUserId: string;
    recordId: string;
  }): Promise<ReminderRecord | null> {
    const item = await stores.savedItemStore.getVisibleSavedItem({
      callerUserId: input.subscriberUserId,
      savedItemId: input.recordId,
    });
    if (!item) return null;
    // Gated on the grounding this subscriber can reach, never on what the item's
    // owner can. A reminder puts the record on someone's device, so the evidence
    // behind it has to be evidence they were actually shown; unreadable grounding
    // reads as restricted and withholds the reminder rather than guessing.
    const source = await stores.sourceRecordStore.getVisibleSourceRecord({
      callerUserId: input.subscriberUserId,
      sourceRecordId: item.sourceRecordId,
    });
    return {
      id: item.id,
      kind: "saved_item",
      ownerUserId: item.ownerUserId,
      subscriberUserId: input.subscriberUserId,
      title: item.title,
      status: item.status,
      occursAt: item.bringBackAt,
      timeSemantics: reminderTimeSemanticsForRecordKind("saved_item"),
      recurrence: null,
      sensitivity: source?.sensitivity ?? "restricted",
      scope: item.scope,
      personId: null,
    };
  }

  /**
   * Loads the Action behind a reminder for the *subscribing* member, who is no
   * longer necessarily its owner.
   *
   * The owner-keyed read still runs first - it is the common private case, and the
   * only path that reaches a review-gated row - but a household-native record is
   * never served from it, because its `ownerUserId` is a storage key and honouring
   * it here would keep alerting a member who has left the household about the
   * household's chores (ADR 0214). Everything else falls through to the
   * scope-visible read, which requires current active membership, so a departed
   * member's record simply stops existing for them and their pending intent is
   * superseded on the next reconciliation.
   */
  async function loadActionReminderRecord(input: {
    ownerUserId: string;
    recordId: string;
    requestedKind: "general_action" | "routine";
  }): Promise<ReminderRecord | null> {
    const owned = await stores.actionStore.getGeneralAction({
      ownerUserId: input.ownerUserId,
      generalActionId: input.recordId,
    });
    const action =
      owned?.ownership === "member_owned"
        ? owned
        : await stores.actionStore.getVisibleGeneralAction({
            callerUserId: input.ownerUserId,
            generalActionId: input.recordId,
          });
    if (!action) return null;
    const kind = action.recurrence ? "routine" : "general_action";
    if (kind !== input.requestedKind) return null;
    // Sensitivity travels with the source record, which is the *action owner's*,
    // so it is resolved against them rather than against the subscriber. A source
    // the subscriber cannot read resolves to `restricted`, which is the
    // fail-closed answer and keeps its content out of an ambient alert.
    const sensitivity = await reminderSourceSensitivity({
      ownerUserId: action.ownerUserId,
      sourceRecordId: action.sourceRecordId,
      getSourceRecord: stores.sourceRecordStore.getSourceRecord,
    });
    return {
      id: action.id,
      kind,
      ownerUserId: action.ownerUserId,
      ownership: action.ownership,
      householdId: action.householdId,
      title: action.title,
      status: action.status,
      occursAt: action.dueAt,
      timeSemantics: reminderTimeSemanticsForRecordKind(kind),
      recurrence: action.recurrence,
      sensitivity,
      scope: action.scope,
      personId: null,
    };
  }

  return async function loadReminderRecord(input: {
    ownerUserId: string;
    recordKind: "general_action" | "routine" | "follow_up" | "saved_item";
    recordId: string;
  }): Promise<ReminderRecord | null> {
    if (input.recordKind === "follow_up") {
      return loadFollowupReminderRecord({
        ownerUserId: input.ownerUserId,
        recordId: input.recordId,
      });
    }
    if (input.recordKind === "saved_item") {
      return loadSavedItemReminderRecord({
        subscriberUserId: input.ownerUserId,
        recordId: input.recordId,
      });
    }
    return loadActionReminderRecord({
      ownerUserId: input.ownerUserId,
      recordId: input.recordId,
      requestedKind: input.recordKind,
    });
  };
}
