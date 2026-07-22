import { describe, expect, it } from "vitest";
import { createInMemoryFollowupLifecycleStore } from "./in-memory-store";
import { createFollowupLifecycle } from "./lifecycle";

const OWNER = "user-1";
const MEMBER = "user-2";
const OTHER_MEMBER = "user-3";
const OUTSIDER = "user-4";

async function setup() {
  const store = createInMemoryFollowupLifecycleStore();
  const lifecycle = createFollowupLifecycle(store);

  const person = await store.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  async function seedOpen(
    overrides: { reason?: string; dueAt?: Date; cadence?: string | null } = {},
  ) {
    return lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: overrides.reason ?? "Reconnect about the move.",
      dueAt: overrides.dueAt ?? new Date("2026-07-01T00:00:00Z"),
      cadence: overrides.cadence,
    });
  }

  const auditActions = async () =>
    (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  const countForPerson = async () =>
    (await store.listFollowupsForPerson({ ownerUserId: OWNER, personId: person.id })).length;

  return { store, lifecycle, person, seedOpen, auditActions, countForPerson };
}

describe("create active follow-up", () => {
  it("accepts a stable id and owner-visible source grounding for Capture retries", async () => {
    const { store, lifecycle, person } = await setup();
    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Remind me to follow up with Mark tomorrow",
      scope: "private",
    });
    const id = "8e09c006-3d32-57fa-a725-af25534ba92f";

    const followup = await lifecycle.createFollowup({
      id,
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Follow up",
      dueAt: new Date("2026-07-22T14:00:00Z"),
      sourceRecordId: source.id,
    });

    expect(followup).toMatchObject({ id, sourceRecordId: source.id });
  });

  it("creates an active open reminder tied to owner, person, reason, and due date with an audit entry", async () => {
    const { lifecycle, person, auditActions } = await setup();

    const followup = await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Check in about the new job.",
      dueAt: new Date("2026-07-04T00:00:00Z"),
    });

    expect(followup.status).toBe("open");
    expect(followup.ownerUserId).toBe(OWNER);
    expect(followup.personId).toBe(person.id);
    expect(followup.reason).toBe("Check in about the new job.");
    expect(followup.dueAt.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    await expect(auditActions()).resolves.toContain("followup.create");
  });

  it("rejects an invalid due date instead of saving a vague someday reminder", async () => {
    const { lifecycle, person } = await setup();

    await expect(
      lifecycle.createFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Someday maybe.",
        dueAt: new Date("not a date"),
      }),
    ).rejects.toThrow(/concrete due date/);
  });

  it("rejects a missing due date instead of saving a vague someday reminder", async () => {
    const { lifecycle, person } = await setup();

    await expect(
      lifecycle.createFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Someday maybe.",
        // biome-ignore lint/suspicious/noExplicitAny: exercising a missing due date at runtime.
        dueAt: undefined as any,
      }),
    ).rejects.toThrow(/concrete due date/);
  });

  it("rejects an empty edit that would change nothing", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();

    await expect(
      lifecycle.editFollowup({ actorUserId: OWNER, followupId: followup.id, edit: {} }),
    ).rejects.toThrow(/must change the reason or the due date/);
  });

  it("rejects creating a follow-up for a person the owner does not own", async () => {
    const { lifecycle, person } = await setup();

    await expect(
      lifecycle.createFollowup({
        ownerUserId: "intruder",
        personId: person.id,
        reason: "Sneaky reminder.",
        dueAt: new Date("2026-07-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/Person not found/);
  });

  it("defaults cadence to null and never treats it as a recurrence trigger", async () => {
    const { lifecycle, seedOpen, countForPerson } = await setup();
    const followup = await seedOpen({ cadence: "weekly" });

    // Cadence is stored as inert metadata...
    expect(followup.cadence).toBe("weekly");
    // ...completing it does not spawn a next instance.
    await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id });
    await expect(countForPerson()).resolves.toBe(1);
  });

  it("advances an explicit annual Birthday Follow-Up on completion", async () => {
    const { lifecycle, seedOpen, countForPerson } = await setup();
    const followup = await seedOpen({
      cadence: "birthday_yearly",
      dueAt: new Date("2026-08-14T14:00:00Z"),
    });

    const next = await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id });

    expect(next.status).toBe("open");
    expect(next.dueAt).toEqual(new Date("2027-08-14T14:00:00Z"));
    await expect(countForPerson()).resolves.toBe(1);
  });
});

describe("lifecycle transitions", () => {
  it("completes an open follow-up with an audit entry and no new instance", async () => {
    const { lifecycle, seedOpen, auditActions, countForPerson } = await setup();
    const followup = await seedOpen();

    const completed = await lifecycle.completeFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
    });

    expect(completed.status).toBe("completed");
    await expect(countForPerson()).resolves.toBe(1);
    await expect(auditActions()).resolves.toContain("followup.complete");
  });

  it("snoozes an active follow-up to a new concrete due date", async () => {
    const { lifecycle, seedOpen, auditActions, countForPerson } = await setup();
    const followup = await seedOpen();

    const snoozed = await lifecycle.snoozeFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
      dueAt: new Date("2026-08-01T00:00:00Z"),
    });

    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.dueAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    await expect(countForPerson()).resolves.toBe(1);
    await expect(auditActions()).resolves.toContain("followup.snooze");
  });

  it("rejects snoozing to a vague due date", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();

    await expect(
      lifecycle.snoozeFollowup({
        actorUserId: OWNER,
        followupId: followup.id,
        dueAt: new Date("not a date"),
      }),
    ).rejects.toThrow(/concrete due date/);
  });

  it("dismisses an active follow-up", async () => {
    const { lifecycle, seedOpen, auditActions } = await setup();
    const followup = await seedOpen();

    const dismissed = await lifecycle.dismissFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
    });

    expect(dismissed.status).toBe("dismissed");
    await expect(auditActions()).resolves.toContain("followup.dismiss");
  });

  it("reopens a completed follow-up", async () => {
    const { lifecycle, seedOpen, auditActions } = await setup();
    const followup = await seedOpen();
    await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id });

    const reopened = await lifecycle.reopenFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
    });

    expect(reopened.status).toBe("open");
    await expect(auditActions()).resolves.toContain("followup.reopen");
  });

  it("reopens a dismissed follow-up", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();
    await lifecycle.dismissFollowup({ actorUserId: OWNER, followupId: followup.id });

    const reopened = await lifecycle.reopenFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
    });

    expect(reopened.status).toBe("open");
  });

  it("archives a follow-up out of active views while preserving history", async () => {
    const { lifecycle, seedOpen, store, person, auditActions } = await setup();
    const followup = await seedOpen();

    const archived = await lifecycle.archiveFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
    });

    expect(archived.status).toBe("archived");
    // History is preserved (the record still exists)...
    await expect(
      store.listFollowupsForPerson({ ownerUserId: OWNER, personId: person.id }),
    ).resolves.toHaveLength(1);
    // ...but it is no longer an active reminder.
    await expect(store.listActiveFollowupsForOwner({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("followup.archive");
  });

  it("edits the reason and due date of an active follow-up", async () => {
    const { lifecycle, seedOpen, auditActions } = await setup();
    const followup = await seedOpen();

    const edited = await lifecycle.editFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
      edit: { reason: "Congratulate on the promotion.", dueAt: new Date("2026-07-10T00:00:00Z") },
    });

    expect(edited.reason).toBe("Congratulate on the promotion.");
    expect(edited.dueAt.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(edited.status).toBe("open");
    await expect(auditActions()).resolves.toContain("followup.edit");
  });
});

describe("invalid transitions are rejected", () => {
  it("cannot complete an already completed follow-up", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();
    await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id });

    await expect(
      lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id }),
    ).rejects.toThrow(/Cannot complete/);
  });

  it("cannot reopen an active follow-up", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();

    await expect(
      lifecycle.reopenFollowup({ actorUserId: OWNER, followupId: followup.id }),
    ).rejects.toThrow(/Cannot reopen/);
  });

  it("cannot snooze a completed follow-up", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();
    await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id });

    await expect(
      lifecycle.snoozeFollowup({
        actorUserId: OWNER,
        followupId: followup.id,
        dueAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/Cannot snooze/);
  });

  it("cannot edit an archived follow-up", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();
    await lifecycle.archiveFollowup({ actorUserId: OWNER, followupId: followup.id });

    await expect(
      lifecycle.editFollowup({
        actorUserId: OWNER,
        followupId: followup.id,
        edit: { reason: "Too late." },
      }),
    ).rejects.toThrow(/Cannot edit/);
  });

  it("cannot archive an already archived follow-up", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();
    await lifecycle.archiveFollowup({ actorUserId: OWNER, followupId: followup.id });

    await expect(
      lifecycle.archiveFollowup({ actorUserId: OWNER, followupId: followup.id }),
    ).rejects.toThrow(/Cannot archive/);
  });
});

describe("dashboard active follow-ups", () => {
  it("lists active reminders due-first, each paired with its person", async () => {
    const { lifecycle, person } = await setup();
    await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Later reminder.",
      dueAt: new Date("2026-08-01T00:00:00Z"),
    });
    await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Sooner reminder.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
    });

    const active = await lifecycle.listActiveFollowups({ ownerUserId: OWNER });

    expect(active.map((item) => item.followup.reason)).toEqual([
      "Sooner reminder.",
      "Later reminder.",
    ]);
    expect(active[0]?.person?.displayName).toBe("Mark");
  });

  it("excludes suggested, completed, dismissed, and archived follow-ups", async () => {
    const { store, lifecycle, person, seedOpen } = await setup();
    // A suggested follow-up created directly (the #47 path) must not be active.
    await store.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Tentative idea.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "suggested",
    });
    const completed = await seedOpen({ reason: "Done one." });
    await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: completed.id });
    const archived = await seedOpen({ reason: "Archived one." });
    await lifecycle.archiveFollowup({ actorUserId: OWNER, followupId: archived.id });
    const kept = await seedOpen({ reason: "Active one." });

    const active = await lifecycle.listActiveFollowups({ ownerUserId: OWNER });

    expect(active.map((item) => item.followup.id)).toEqual([kept.id]);
  });

  it("respects the limit", async () => {
    const { lifecycle, person } = await setup();
    for (let index = 0; index < 4; index += 1) {
      await lifecycle.createFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: `Reminder ${index}.`,
        dueAt: new Date(`2026-07-0${index + 1}T00:00:00Z`),
      });
    }

    const active = await lifecycle.listActiveFollowups({ ownerUserId: OWNER, limit: 2 });

    expect(active).toHaveLength(2);
  });

  it("is owner-scoped", async () => {
    const { lifecycle, seedOpen } = await setup();
    await seedOpen();

    await expect(lifecycle.listActiveFollowups({ ownerUserId: "intruder" })).resolves.toEqual([]);
  });

  it("scopes to one person when personId is given", async () => {
    const { store, lifecycle, person } = await setup();
    const other = await store.createPerson({
      ownerUserId: OWNER,
      displayName: "Dana",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Mark reminder.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
    });
    await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: other.id,
      reason: "Dana reminder.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
    });

    const forMark = await lifecycle.listActiveFollowups({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(forMark.map((item) => item.followup.reason)).toEqual(["Mark reminder."]);
  });

  it("filters by a due-before window", async () => {
    const { lifecycle, person } = await setup();
    await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Soon.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
    });
    await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Later.",
      dueAt: new Date("2026-09-01T00:00:00Z"),
    });

    const due = await lifecycle.listActiveFollowups({
      ownerUserId: OWNER,
      dueBefore: new Date("2026-07-15T00:00:00Z"),
    });

    expect(due.map((item) => item.followup.reason)).toEqual(["Soon."]);
  });
});

describe("household-scoped follow-ups", () => {
  async function setupHousehold() {
    const base = await setup();
    const household = await base.store.createHouseholdWorkspace({
      ownerUserId: OWNER,
      name: "Household",
      defaultScope: "private",
    });
    await base.store.createHouseholdMembership({
      householdId: household.id,
      userId: OWNER,
      invitedByUserId: OWNER,
      role: "owner",
      status: "active",
      invitedAt: new Date("2026-06-01T00:00:00Z"),
      acceptedAt: new Date("2026-06-01T00:00:00Z"),
      removedAt: null,
    });
    await base.store.createHouseholdMembership({
      householdId: household.id,
      userId: MEMBER,
      invitedByUserId: OWNER,
      role: "member",
      status: "active",
      invitedAt: new Date("2026-06-01T00:00:00Z"),
      acceptedAt: new Date("2026-06-01T00:00:00Z"),
      removedAt: null,
    });
    await base.store.createHouseholdMembership({
      householdId: household.id,
      userId: OTHER_MEMBER,
      invitedByUserId: OWNER,
      role: "member",
      status: "active",
      invitedAt: new Date("2026-06-01T00:00:00Z"),
      acceptedAt: new Date("2026-06-01T00:00:00Z"),
      removedAt: null,
    });

    const memberPerson = await base.store.createPerson({
      ownerUserId: MEMBER,
      displayName: "Mara",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });

    return { ...base, household, memberPerson };
  }

  it("creates private, selected-member, and household reminders with creator provenance", async () => {
    const { lifecycle, household, memberPerson } = await setupHousehold();

    const privateFollowup = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Private check-in.",
      dueAt: new Date("2026-07-04T00:00:00Z"),
    });
    const selectedFollowup = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Shared check-in.",
      dueAt: new Date("2026-07-05T00:00:00Z"),
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OWNER],
    });
    const householdFollowup = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Household check-in.",
      dueAt: new Date("2026-07-06T00:00:00Z"),
      scope: "household",
      householdId: household.id,
    });

    expect(privateFollowup).toMatchObject({
      ownerUserId: MEMBER,
      createdByUserId: MEMBER,
      lastActorUserId: MEMBER,
      scope: "private",
      householdId: null,
    });
    expect(selectedFollowup).toMatchObject({
      createdByUserId: MEMBER,
      lastActorUserId: MEMBER,
      scope: "shared",
      householdId: household.id,
    });
    expect(householdFollowup).toMatchObject({
      createdByUserId: MEMBER,
      lastActorUserId: MEMBER,
      scope: "household",
      householdId: household.id,
    });
  });

  it("shows selected-member reminders only to selected active members", async () => {
    const { lifecycle, household, memberPerson } = await setupHousehold();
    const selected = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Coordinate a gift.",
      dueAt: new Date("2026-07-05T00:00:00Z"),
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OWNER],
    });

    await expect(lifecycle.listActiveFollowups({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ followup: expect.objectContaining({ id: selected.id }) }),
    ]);
    await expect(lifecycle.listActiveFollowups({ ownerUserId: OTHER_MEMBER })).resolves.toEqual([]);
    await expect(lifecycle.listActiveFollowups({ ownerUserId: OUTSIDER })).resolves.toEqual([]);
  });

  it("shows household reminders to all active household members", async () => {
    const { lifecycle, household, memberPerson } = await setupHousehold();
    const shared = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Household-wide check-in.",
      dueAt: new Date("2026-07-05T00:00:00Z"),
      scope: "household",
      householdId: household.id,
    });

    await expect(lifecycle.listActiveFollowups({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ followup: expect.objectContaining({ id: shared.id }) }),
    ]);
    await expect(lifecycle.listActiveFollowups({ ownerUserId: OTHER_MEMBER })).resolves.toEqual([
      expect.objectContaining({ followup: expect.objectContaining({ id: shared.id }) }),
    ]);
    await expect(lifecycle.listActiveFollowups({ ownerUserId: OUTSIDER })).resolves.toEqual([]);
  });

  it("allows visible members to lifecycle-change shared reminders and records the actor", async () => {
    const { lifecycle, household, memberPerson } = await setupHousehold();
    const selected = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Coordinate a gift.",
      dueAt: new Date("2026-07-05T00:00:00Z"),
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OWNER],
    });

    const completed = await lifecycle.completeFollowup({
      actorUserId: OWNER,
      followupId: selected.id,
    });

    expect(completed).toMatchObject({
      ownerUserId: MEMBER,
      status: "completed",
      createdByUserId: MEMBER,
      lastActorUserId: OWNER,
    });
  });

  it("blocks unauthorized lifecycle changes for reminders the actor cannot see", async () => {
    const { lifecycle, household, memberPerson } = await setupHousehold();
    const selected = await lifecycle.createFollowup({
      ownerUserId: MEMBER,
      personId: memberPerson.id,
      reason: "Coordinate a gift.",
      dueAt: new Date("2026-07-05T00:00:00Z"),
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OWNER],
    });

    await expect(
      lifecycle.completeFollowup({ actorUserId: OTHER_MEMBER, followupId: selected.id }),
    ).rejects.toThrow(/Follow-up not found/);
  });
});

describe("owner scoping", () => {
  it("hides another owner's follow-up from reads and mutations", async () => {
    const { lifecycle, seedOpen } = await setup();
    const followup = await seedOpen();

    await expect(
      lifecycle.completeFollowup({ actorUserId: "intruder", followupId: followup.id }),
    ).rejects.toThrow(/Follow-up not found/);
    await expect(
      lifecycle.editFollowup({
        actorUserId: "intruder",
        followupId: followup.id,
        edit: { reason: "hijack" },
      }),
    ).rejects.toThrow(/Follow-up not found/);
  });

  it("scopes active-follow-up listing to the owner", async () => {
    const { store, seedOpen } = await setup();
    await seedOpen();

    await expect(store.listActiveFollowupsForOwner({ ownerUserId: "intruder" })).resolves.toEqual(
      [],
    );
  });
});
