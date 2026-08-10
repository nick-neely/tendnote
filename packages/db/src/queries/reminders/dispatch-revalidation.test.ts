import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemoryGeneralActionStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import type { GeneralActionLifecycleStore } from "../general-actions/types";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createHouseholdLifecycle } from "../households/lifecycle";
import { createHouseholdSavedItemCollaboration } from "../saved-items/household-native";
import { createInMemorySavedItemLifecycleStore } from "../saved-items/in-memory-store";
import { createSavedItemLifecycle } from "../saved-items/lifecycle";
import { createInMemoryReminderStore } from "./in-memory-store";
import { createReminderRecordLoader } from "./record-loaders";
import { createReminderService } from "./service";
import { createReminderSubscriptionAuthorizer } from "./subscription-authorization";

/**
 * What dispatch does at the last safe point, for every kind that can hold a
 * Reminder Schedule.
 *
 * The reconcile-time suites beside this one prove that a membership change
 * supersedes a pending intent. This one proves the half that has to hold even
 * when no reconcile ever ran: an alert that was scheduled, materialized, and
 * queued while someone still belonged is refused at the moment it would be sent,
 * because the record is reloaded and the subscription re-proved against the
 * household as it stands right then. A queue is a place where authority goes
 * stale, and a background job proves again before any durable action.
 *
 * Deliberately driven through {@link createReminderRecordLoader} and
 * {@link createReminderSubscriptionAuthorizer} — the same two functions the
 * composition root wires — over in-memory stores that share one household. A
 * suite that reimplemented either would be testing its own reimplementation of
 * the thing that revokes access.
 */
const ANA = "ana";
const BEN = "ben";
const NOW = new Date("2026-07-21T15:00:00.000Z");
/** 09:00 America/Chicago on the day everything below is due. */
const DUE_AT = new Date("2026-08-14T00:00:00.000Z");
const DISPATCH_AT = new Date("2026-08-14T14:00:05.000Z");

const deepLink = (recordKind: string, recordId: string) =>
  `/reminders/open?kind=${recordKind}&id=${recordId}`;

/**
 * A Follow-Up as its store answers for it: only ever to its own owner.
 *
 * Held here rather than in a store because the Follow-Up store's owner-keyed
 * read is the whole of what this suite needs from that family, and standing it
 * up would add a domain without adding a question.
 */
type SeededFollowup = {
  id: string;
  ownerUserId: string;
  reason: string;
  status: string;
  dueAt: Date;
  scope: "private" | "shared" | "household";
  personId: string;
  sourceRecordId: string | null;
};

async function seedStack(followup?: SeededFollowup) {
  // One household store behind every domain, which is what a single database
  // gives them in production. Two would let the domains disagree about who is a
  // member, and disagreement is exactly what this suite must not simulate away.
  const savedItems = createInMemorySavedItemLifecycleStore();
  const workspace = await seedHouseholdWithMembers(savedItems, {
    ownerUserId: ANA,
    name: "Home",
    members: [
      [ANA, "owner"],
      [BEN, "member"],
    ],
  });

  const actionStore: GeneralActionLifecycleStore = {
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(savedItems),
    getPerson: (input) => savedItems.getPerson(input),
    getSourceRecord: (input) => savedItems.getSourceRecord(input),
    getVisibleSourceRecord: (input) => savedItems.getVisibleSourceRecord(input),
  };

  const reminders = createInMemoryReminderStore();
  const service = createReminderService({
    store: reminders,
    authorizeSubscription: createReminderSubscriptionAuthorizer(
      createHouseholdAuthorizationProver(savedItems),
    ),
    loadReminderRecord: createReminderRecordLoader({
      actionStore,
      followupStore: {
        // Owner-keyed, exactly as the real store is: a Follow-Up is only ever
        // its owner's, which is why the kind cannot be revoked by a household
        // change and why its case below asserts delivery rather than refusal.
        getFollowup: async (input: { ownerUserId: string; followupId: string }) =>
          followup && input.ownerUserId === followup.ownerUserId && input.followupId === followup.id
            ? (followup as never)
            : null,
      },
      savedItemStore: savedItems,
      sourceRecordStore: savedItems,
    }),
  });

  return {
    savedItems,
    household: createHouseholdLifecycle(savedItems),
    actions: createGeneralActionLifecycle(actionStore),
    collaboration: createHouseholdSavedItemCollaboration(savedItems),
    savedItemLifecycle: createSavedItemLifecycle(savedItems),
    reminders,
    service,
    householdId: workspace.id,
  };
}

type Stack = Awaited<ReturnType<typeof seedStack>>;

/** Subscribes a member and queues the delivery their installation earns. */
async function queueAlert(
  stack: Stack,
  input: { subscriberUserId: string; recordKind: string; recordId: string },
) {
  await stack.service.saveReminder({
    ownerUserId: input.subscriberUserId,
    recordKind: input.recordKind as never,
    recordId: input.recordId,
    clientInstallationId: `installation-${input.subscriberUserId}`,
    timeZone: "America/Chicago",
    // A Routine's schedule has to be relative to each occurrence; every other
    // kind pins an exact local time. The shape differs, the revocation does not.
    schedule:
      input.recordKind === "routine"
        ? { kind: "relative", leadMinutes: 0 }
        : { kind: "exact", localTime: "09:00" },
    now: NOW,
  });
  const registration = await stack.service.registerReminderInstallation({
    ownerUserId: input.subscriberUserId,
    clientInstallationId: `installation-${input.subscriberUserId}`,
    subscription: {
      endpoint: `https://push.example.test/${input.subscriberUserId}`,
      expirationTime: null,
      keys: { p256dh: "p256dh", auth: "auth" },
    },
    now: new Date(NOW.getTime() + 60_000),
  });
  const jobId = registration.deliveryJobs[0]?.id;
  expect(jobId, "expected a queued delivery job").toBeDefined();
  return jobId as string;
}

function dispatch(stack: Stack, jobId: string) {
  const sends: unknown[] = [];
  return stack.service
    .dispatchReminder({
      deepLink,
      jobId,
      now: DISPATCH_AT,
      sender: async (payload) => {
        sends.push(payload);
        return { status: "accepted" as const, providerId: "push-1" };
      },
    })
    .then((result) => ({ result, sends }));
}

describe("dispatch re-proves standing for every reminder-capable kind", () => {
  it.each([
    ["general_action", null],
    ["routine", { interval: 1, unit: "week" as const }],
  ])("refuses a departed member their queued %s alert", async (kind, recurrence) => {
    const stack = await seedStack();
    const action = await stack.actions.createGeneralAction({
      ownerUserId: ANA,
      title: "Put the bins out",
      ownership: "household_native",
      householdId: stack.householdId,
      dueAt: DUE_AT,
      recurrence,
    });
    const jobId = await queueAlert(stack, {
      subscriberUserId: BEN,
      recordKind: kind,
      recordId: action.id,
    });

    // Everything about this alert was legitimate when it was written. Only Ben's
    // standing changed, and nothing swept the queue.
    await removeHouseholdMember(stack.savedItems, { householdId: stack.householdId, userId: BEN });
    const { result, sends } = await dispatch(stack, jobId);

    expect(result).toEqual({ status: "suppressed", reason: "suppressed_ineligible" });
    expect(sends).toEqual([]);
  });

  it("refuses a departed member their queued Saved Item alert", async () => {
    const stack = await seedStack();
    const item = await stack.collaboration.createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: DUE_AT,
    });
    const jobId = await queueAlert(stack, {
      subscriberUserId: BEN,
      recordKind: "saved_item",
      recordId: item.id,
    });

    await removeHouseholdMember(stack.savedItems, { householdId: stack.householdId, userId: BEN });
    const { result, sends } = await dispatch(stack, jobId);

    expect(result).toEqual({ status: "suppressed", reason: "suppressed_ineligible" });
    expect(sends).toEqual([]);
  });

  it("refuses a member dropped from a narrowed audience, without their membership changing", async () => {
    // Audience narrowing and departure are different events with the same
    // obligation. Ben is still very much in the household here; he is simply no
    // longer among the people Ana chose.
    const stack = await seedStack();
    const item = await stack.savedItemLifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Pick the paint up",
      bringBackAt: DUE_AT,
      scope: "shared",
      householdId: stack.householdId,
      selectedUserIds: [BEN],
    });
    const jobId = await queueAlert(stack, {
      subscriberUserId: BEN,
      recordKind: "saved_item",
      recordId: item.id,
    });

    // Ana re-selects the audience and leaves Ben out of it. This is the real
    // narrowing path, not a patched row: the share rows the previous selection
    // wrote are what a `shared` record's visibility is made of.
    await stack.household.shareRecordWithSelectedMembers({
      actorUserId: ANA,
      householdId: stack.householdId,
      recordKind: "saved_item",
      recordId: item.id,
      selectedUserIds: [],
    });
    const { result, sends } = await dispatch(stack, jobId);

    expect(result).toEqual({ status: "suppressed", reason: "suppressed_ineligible" });
    expect(sends).toEqual([]);
  });

  it("still delivers to the member who stayed, so revocation is aimed rather than broad", async () => {
    const stack = await seedStack();
    const action = await stack.actions.createGeneralAction({
      ownerUserId: ANA,
      title: "Put the bins out",
      ownership: "household_native",
      householdId: stack.householdId,
      dueAt: DUE_AT,
      recurrence: null,
    });
    const anasJob = await queueAlert(stack, {
      subscriberUserId: ANA,
      recordKind: "general_action",
      recordId: action.id,
    });
    const bensJob = await queueAlert(stack, {
      subscriberUserId: BEN,
      recordKind: "general_action",
      recordId: action.id,
    });

    await removeHouseholdMember(stack.savedItems, { householdId: stack.householdId, userId: BEN });

    await expect(dispatch(stack, bensJob).then((r) => r.result)).resolves.toEqual({
      status: "suppressed",
      reason: "suppressed_ineligible",
    });
    const ana = await dispatch(stack, anasJob);
    expect(ana.result).toMatchObject({ status: "accepted" });
    expect(ana.sends).toHaveLength(1);
  });

  it("refuses everyone once the household has ended", async () => {
    // Dissolution is every membership ending at once. Nobody is left with
    // standing, so no queued alert about the workspace's own record survives it -
    // including the owner's, which is the case a per-member sweep would miss.
    const stack = await seedStack();
    const item = await stack.collaboration.createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: DUE_AT,
    });
    const jobs = await Promise.all(
      [ANA, BEN].map((subscriberUserId) =>
        queueAlert(stack, { subscriberUserId, recordKind: "saved_item", recordId: item.id }),
      ),
    );

    for (const userId of [ANA, BEN]) {
      await removeHouseholdMember(stack.savedItems, { householdId: stack.householdId, userId });
    }
    await stack.savedItems.updateHouseholdWorkspace({
      householdId: stack.householdId,
      patch: { status: "dissolved", dissolvedAt: new Date("2026-08-01T00:00:00.000Z") },
    });

    for (const jobId of jobs) {
      const { result, sends } = await dispatch(stack, jobId);
      expect(result).toEqual({ status: "suppressed", reason: "suppressed_ineligible" });
      expect(sends).toEqual([]);
    }
  });

  it("tells a suppressed subscriber's trail nothing about the record it withheld", async () => {
    const stack = await seedStack();
    const item = await stack.collaboration.createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: DUE_AT,
    });
    const jobId = await queueAlert(stack, {
      subscriberUserId: BEN,
      recordKind: "saved_item",
      recordId: item.id,
    });
    await removeHouseholdMember(stack.savedItems, { householdId: stack.householdId, userId: BEN });
    await dispatch(stack, jobId);

    const audit = await stack.reminders.listAuditEntries({ ownerUserId: BEN });
    expect(audit.map((entry) => entry.action)).toContain("reminder.delivery_suppressed");
    // The refusal is the same shape whether the record was completed, deleted,
    // or is one he may no longer see. A title here would be the disclosure the
    // suppression exists to prevent.
    expect(JSON.stringify(audit)).not.toMatch(/Boiler service/i);
  });
});

describe("a member-owned reminder leaves with its owner rather than being revoked", () => {
  it("keeps delivering a Follow-Up alert to the member who owns it after they leave", async () => {
    // The mirror case, and the one that makes the rest meaningful: departure ends
    // access, not ownership. A Follow-Up is always its owner's, so losing a
    // household cannot cost them their own reminder about their own record.
    const followup = {
      id: "00000000-0000-4000-8000-0000000000f1",
      ownerUserId: BEN,
      reason: "Ring the plumber",
      status: "open",
      dueAt: DUE_AT,
      scope: "private" as const,
      personId: "00000000-0000-4000-8000-0000000000p1",
      sourceRecordId: null,
    };
    const stack = await seedStack(followup);
    const jobId = await queueAlert(stack, {
      subscriberUserId: BEN,
      recordKind: "follow_up",
      recordId: followup.id,
    });

    await removeHouseholdMember(stack.savedItems, { householdId: stack.householdId, userId: BEN });
    const { result, sends } = await dispatch(stack, jobId);

    expect(result).toMatchObject({ status: "accepted" });
    expect(sends).toHaveLength(1);
  });
});
