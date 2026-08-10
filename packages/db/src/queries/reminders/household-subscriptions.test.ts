import { describe, expect, it } from "vitest";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createHouseholdSavedItemCollaboration } from "../saved-items/household-native";
import { createInMemorySavedItemLifecycleStore } from "../saved-items/in-memory-store";
import { createSavedItemLifecycle } from "../saved-items/lifecycle";
import { createInMemoryReminderStore } from "./in-memory-store";
import { reminderSubscriber } from "./policy";
import { createReminderService } from "./service";
import type { ReminderRecord } from "./types";

const ANA = "ana";
const BEN = "ben";
const NOW = new Date("2026-07-21T15:00:00.000Z");
const BRING_BACK = new Date("2026-08-14T00:00:00.000Z");

/**
 * A Saved Item reminder stack wired the way production wires it: the record is
 * loaded by *visibility*, not by ownership.
 *
 * That single substitution is what the household clause of the spec comes down
 * to - "each active member who can currently see an item may choose their own
 * Reminder Schedule for it" - and it is why these tests drive the real
 * collaboration boundary and the real visibility-scoped store rather than a
 * hand-written record fake. A fake would happily return a record for a caller
 * the proof refuses, which is precisely the bug being guarded against.
 */
async function seedStack() {
  const savedItems = createInMemorySavedItemLifecycleStore();
  const household = await seedHouseholdWithMembers(savedItems, {
    ownerUserId: ANA,
    members: [
      [ANA, "owner"],
      [BEN, "member"],
    ],
  });
  const reminders = createInMemoryReminderStore();
  const service = createReminderService({
    store: reminders,
    async loadReminderRecord(input): Promise<ReminderRecord | null> {
      const item = await savedItems.getVisibleSavedItem({
        callerUserId: input.ownerUserId,
        savedItemId: input.recordId,
      });
      if (!item) return null;
      const source = await savedItems.getVisibleSourceRecord({
        callerUserId: input.ownerUserId,
        sourceRecordId: item.sourceRecordId,
      });
      return {
        id: item.id,
        kind: "saved_item",
        ownerUserId: item.ownerUserId,
        subscriberUserId: input.ownerUserId,
        title: item.title,
        status: item.status,
        occursAt: item.bringBackAt,
        timeSemantics: "date_only",
        recurrence: null,
        sensitivity: source?.sensitivity ?? "restricted",
        scope: item.scope,
        personId: null,
      };
    },
  });
  return { savedItems, reminders, service, householdId: household.id };
}

type Stack = Awaited<ReturnType<typeof seedStack>>;

function subscribe(stack: Stack, subscriberUserId: string, savedItemId: string) {
  return stack.service.saveReminder({
    ownerUserId: subscriberUserId,
    recordKind: "saved_item",
    recordId: savedItemId,
    clientInstallationId: `installation-${subscriberUserId}`,
    timeZone: "America/Chicago",
    schedule: { kind: "exact", localTime: "09:00" },
    now: NOW,
  });
}

describe("a Reminder Schedule belongs to the member who chose it", () => {
  it("lets any member who can see a household-native item subscribe for themselves", async () => {
    const stack = await seedStack();
    // Ana writes it; the workspace owns it. Ben never owns it and never will.
    const item = await createHouseholdSavedItemCollaboration(
      stack.savedItems,
    ).createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: BRING_BACK,
    });

    const scheduled = await subscribe(stack, BEN, item.id);

    expect(scheduled.schedule).toMatchObject({ ownerUserId: BEN, recordKind: "saved_item" });
    // Ben's subscription is his alone: nothing about it enrolled Ana.
    await expect(stack.reminders.listSchedulesForOwner({ ownerUserId: ANA })).resolves.toEqual([]);
  });

  it("lets a member a Saved Item was shared with subscribe without gaining authority over it", async () => {
    const stack = await seedStack();
    const lifecycle = createSavedItemLifecycle(stack.savedItems);
    const mine = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Pick the paint up",
      bringBackAt: BRING_BACK,
      scope: "shared",
      householdId: stack.householdId,
      selectedUserIds: [BEN],
    });

    const scheduled = await subscribe(stack, BEN, mine.id);

    expect(scheduled.schedule?.ownerUserId).toBe(BEN);
    // A schedule is the whole of what he got. The item is still Ana's.
    await expect(
      lifecycle.editSavedItem({ actorUserId: BEN, savedItemId: mine.id, edit: { title: "Mine" } }),
    ).rejects.toThrow("Saved Item not found.");
  });

  it("refuses a subscription from someone who cannot see the item", async () => {
    const stack = await seedStack();
    const lifecycle = createSavedItemLifecycle(stack.savedItems);
    const privateItem = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Only mine",
      bringBackAt: BRING_BACK,
    });

    await expect(subscribe(stack, BEN, privateItem.id)).rejects.toThrow(
      "eligible explicit time-bound record",
    );
  });

  it("withholds a reminder when the subscriber cannot read the grounding", async () => {
    const stack = await seedStack();
    const lifecycle = createSavedItemLifecycle(stack.savedItems);
    // Evidence Ana captured privately, reused as the grounding for an item she
    // then shows the whole household. The item is visible to Ben; the source
    // behind it never was. A reminder puts the record on a device, so it is
    // gated on the grounding the subscriber can actually reach.
    const privateSource = await stack.savedItems.createSourceRecord({
      ownerUserId: ANA,
      sourceType: "manual",
      content: "Something I wrote only for myself",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "high",
      sensitivity: "normal",
      scope: "private",
      householdId: null,
      importance: 3,
      metadataJson: {},
    });
    const item = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Grounded only for Ana",
      bringBackAt: BRING_BACK,
      scope: "household",
      householdId: stack.householdId,
      sourceRecordId: privateSource.id,
    });

    await expect(subscribe(stack, BEN, item.id)).rejects.toThrow(
      "eligible explicit time-bound record",
    );
    // Ana, who captured the evidence, is unaffected.
    await expect(subscribe(stack, ANA, item.id)).resolves.toMatchObject({
      schedule: { ownerUserId: ANA },
    });
  });
});

describe("subscriptions follow current visibility", () => {
  it("supersedes a departed member's pending intents on the next reconcile", async () => {
    const stack = await seedStack();
    const item = await createHouseholdSavedItemCollaboration(
      stack.savedItems,
    ).createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: BRING_BACK,
    });
    await subscribe(stack, BEN, item.id);
    await expect(
      stack.reminders.listOccurrenceIntents({
        ownerUserId: BEN,
        recordKind: "saved_item",
        recordId: item.id,
      }),
    ).resolves.not.toEqual([]);

    const membership = await stack.savedItems.getHouseholdMembership({
      householdId: stack.householdId,
      userId: BEN,
    });
    await stack.savedItems.updateHouseholdMembership({
      membershipId: membership?.id as string,
      patch: { status: "removed", removedAt: NOW },
    });
    await stack.service.reconcileReminderRecord({
      ownerUserId: BEN,
      recordKind: "saved_item",
      recordId: item.id,
      now: NOW,
    });

    const intents = await stack.reminders.listOccurrenceIntents({
      ownerUserId: BEN,
      recordKind: "saved_item",
      recordId: item.id,
    });
    expect(intents.every((intent) => intent.status === "superseded")).toBe(true);
  });

  it("regenerates a still-authorized subscriber's intent when the item's timing changes", async () => {
    const stack = await seedStack();
    const collaboration = createHouseholdSavedItemCollaboration(stack.savedItems);
    const item = await collaboration.createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: BRING_BACK,
    });
    await subscribe(stack, BEN, item.id);

    const moved = new Date("2026-08-20T00:00:00.000Z");
    const edited = await collaboration.editHouseholdSavedItem({
      actorUserId: ANA,
      savedItemId: item.id,
      expectedVersion: item.version,
      edit: { bringBackAt: moved },
    });
    // The revalidation pass production runs after a household-native write.
    for (const schedule of await stack.reminders.listScheduleSubscribers({
      recordKind: "saved_item",
      recordId: item.id,
    })) {
      await stack.service.reconcileReminderRecord({
        ownerUserId: schedule.ownerUserId,
        recordKind: "saved_item",
        recordId: item.id,
        now: NOW,
      });
    }

    expect(edited.bringBackAt).toEqual(moved);
    // Ben's own schedule, moved with Ana's edit, without Ana ever touching it.
    const [benSchedule] = await stack.reminders.listSchedules({
      ownerUserId: BEN,
      recordKind: "saved_item",
      recordId: item.id,
    });
    expect(benSchedule?.occurrenceKey).toContain("2026-08-20");
  });

  it("names every subscriber of one record so a change can reach all of them", async () => {
    const stack = await seedStack();
    const item = await createHouseholdSavedItemCollaboration(
      stack.savedItems,
    ).createHouseholdSavedItem({
      actorUserId: ANA,
      householdId: stack.householdId,
      kind: "note",
      title: "Boiler service is due",
      bringBackAt: BRING_BACK,
    });
    await subscribe(stack, ANA, item.id);
    await subscribe(stack, BEN, item.id);

    const subscribers = await stack.reminders.listScheduleSubscribers({
      recordKind: "saved_item",
      recordId: item.id,
    });

    expect(subscribers.map((schedule) => schedule.ownerUserId).sort()).toEqual([ANA, BEN]);
  });
});

describe("reminderSubscriber", () => {
  const base = {
    id: "item",
    kind: "saved_item",
    title: "t",
    status: "active",
    occursAt: BRING_BACK,
    timeSemantics: "date_only",
    recurrence: null,
    sensitivity: "normal",
    scope: "household",
    personId: null,
  } satisfies Omit<ReminderRecord, "ownerUserId">;

  it("falls back to the owner, so owner-keyed loaders keep their old rule", () => {
    expect(reminderSubscriber({ ...base, ownerUserId: ANA })).toBe(ANA);
  });

  it("prefers the subscriber the loader proved the record for", () => {
    expect(reminderSubscriber({ ...base, ownerUserId: ANA, subscriberUserId: BEN })).toBe(BEN);
  });

  it("authorizes nobody for a workspace-owned record a loader forgot to attribute", () => {
    // The fail-closed direction: null never equals a real user id, so a loader
    // that omits the subscriber refuses everyone rather than admitting anyone.
    expect(reminderSubscriber({ ...base, ownerUserId: null })).toBeNull();
  });
});

describe("dispatch-time identity", () => {
  it("is the subscriber, not the record owner", async () => {
    // Guards the dispatch recheck against being 'simplified' back to the owner:
    // for a household-native item the owner is null, so an owner comparison
    // would suppress every delivery, and for a shared item it would suppress
    // exactly the non-owner subscribers this feature exists for.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./dispatch.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain("reminderSubscriber(context.record) !== claimed.ownerUserId");
    expect(source).not.toContain("context.record.ownerUserId !== claimed.ownerUserId");
  });
});
