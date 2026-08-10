/**
 * Live verification for the household purge sweep, run by hand against the
 * disposable dev database.
 *
 * Not a unit test and deliberately not in the suite: what it proves is the one
 * thing an in-memory store cannot, which is that the delete order actually
 * satisfies Postgres — every foreign key, every `on delete` rule, and
 * `saved_items_ownership_check`, the constraint that turns a wrong order into an
 * aborted transaction rather than a stray row.
 *
 *   pnpm --filter @tendnote/db db:purge:check
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../client";
import {
  assetEvidence,
  assetMemories,
  assets,
  auditLog,
  contextFacts,
  followups,
  generalActions,
  giftIdeas,
  giftPlans,
  householdEventPlanLinks,
  householdEventPlans,
  householdInvitations,
  householdMemberships,
  householdRecordShares,
  householdWorkspaces,
  memories,
  people,
  personReferences,
  reminderSchedules,
  savedItems,
  sourceRecords,
} from "../../schema";
import { createDrizzleHouseholdPurgeStore } from "./drizzle-purge-store";
import { runHouseholdPurgeSweep } from "./purge";

const OWNER = "demo-user";
const MEMBER = "demo-member";
const DAY_MS = 24 * 60 * 60 * 1000;

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

async function seedDissolvedHousehold(dissolvedAt: Date) {
  const db = getDb();
  const [workspace] = await db
    .insert(householdWorkspaces)
    .values({
      ownerUserId: OWNER,
      name: `Purge live check ${randomUUID().slice(0, 8)}`,
      status: "dissolved",
      dissolvedAt,
    })
    .returning();
  if (!workspace) throw new Error("failed to seed workspace");
  const householdId = workspace.id;

  await db.insert(householdMemberships).values([
    {
      householdId,
      userId: OWNER,
      invitedByUserId: OWNER,
      role: "owner",
      status: "removed",
      removedAt: dissolvedAt,
    },
    {
      householdId,
      userId: MEMBER,
      invitedByUserId: OWNER,
      role: "member",
      status: "removed",
      removedAt: dissolvedAt,
    },
  ]);

  const [person] = await db
    .insert(people)
    .values({ ownerUserId: OWNER, displayName: "Purge check person" })
    .returning();
  if (!person) throw new Error("failed to seed person");

  // Two source records: one grounding the household's own Saved Item (held back
  // at dissolution on purpose), one the member simply shared.
  const [groundingSource, sharedSource] = await db
    .insert(sourceRecords)
    .values([
      { ownerUserId: MEMBER, content: "grounding", scope: "household", householdId },
      { ownerUserId: MEMBER, content: "shared", scope: "household", householdId },
    ])
    .returning();
  if (!groundingSource || !sharedSource) throw new Error("failed to seed source records");

  const [householdSavedItem, memberSavedItem] = await db
    .insert(savedItems)
    .values([
      {
        ownerUserId: null,
        ownership: "household_native",
        createdByUserId: MEMBER,
        kind: "note",
        title: "household note",
        scope: "household",
        householdId,
        sourceRecordId: groundingSource.id,
      },
      {
        ownerUserId: MEMBER,
        ownership: "member_owned",
        kind: "note",
        title: "member note",
        scope: "household",
        householdId,
        sourceRecordId: sharedSource.id,
      },
    ])
    .returning();
  if (!householdSavedItem || !memberSavedItem) throw new Error("failed to seed saved items");

  const [householdAction, memberAction] = await db
    .insert(generalActions)
    .values([
      {
        ownerUserId: MEMBER,
        ownership: "household_native",
        title: "household chore",
        scope: "household",
        householdId,
      },
      {
        ownerUserId: MEMBER,
        ownership: "member_owned",
        title: "member errand",
        scope: "household",
        householdId,
      },
    ])
    .returning();
  if (!householdAction || !memberAction) throw new Error("failed to seed actions");

  const [householdAsset] = await db
    .insert(assets)
    .values({
      ownerUserId: MEMBER,
      ownership: "household_native",
      name: "household fridge",
      kind: "appliance",
      scope: "household",
      householdId,
      createdByUserId: MEMBER,
    })
    .returning();
  if (!householdAsset) throw new Error("failed to seed asset");

  await db.insert(assetMemories).values([
    {
      assetId: householdAsset.id,
      ownerUserId: MEMBER,
      ownership: "household_native",
      label: "filter size",
      scope: "household",
      householdId,
    },
    // A member's own note on the household's Asset: cascaded away with its
    // parent, and counted rather than lost quietly.
    {
      assetId: householdAsset.id,
      ownerUserId: OWNER,
      ownership: "member_owned",
      label: "my receipt note",
      scope: "private",
    },
  ]);
  await db.insert(assetEvidence).values({
    assetId: householdAsset.id,
    ownerUserId: MEMBER,
    ownership: "household_native",
    kind: "receipt",
    label: "warranty",
    scope: "household",
    householdId,
    sourceRecordId: groundingSource.id,
  });

  const [eventPlan] = await db
    .insert(householdEventPlans)
    .values({
      householdId,
      createdByUserId: OWNER,
      lastActorUserId: OWNER,
      title: "bin day",
    })
    .returning();
  if (!eventPlan) throw new Error("failed to seed event plan");
  await db.insert(householdEventPlanLinks).values({
    planId: eventPlan.id,
    linkKind: "general_action",
    recordId: householdAction.id,
    linkedByUserId: OWNER,
  });

  await db.insert(contextFacts).values({
    subjectKind: "household",
    subjectHouseholdId: householdId,
    category: "composition",
    content: "two adults",
    normalizedContent: "two adults",
    provenanceJson: { kind: "manual" } as never,
    creatorUserId: OWNER,
    lastActorUserId: OWNER,
  });

  await db.insert(personReferences).values({
    householdId,
    recordKind: "saved_item",
    recordId: memberSavedItem.id,
    label: "the neighbour",
    createdByUserId: OWNER,
  });

  await db.insert(householdRecordShares).values({
    householdId,
    recordKind: "saved_item",
    recordId: memberSavedItem.id,
    sharedWithUserId: OWNER,
    sharedByUserId: MEMBER,
  });

  await db.insert(householdInvitations).values({
    householdId,
    invitedByUserId: OWNER,
    email: "someone@example.test",
    normalizedEmail: "someone@example.test",
    secretDigest: randomUUID(),
    expiresAt: new Date(Date.now() + DAY_MS),
  });

  // A member-owned Gift Plan the best-effort post-commit hook did not privatize.
  const [giftPlan] = await db
    .insert(giftPlans)
    .values({
      ownerUserId: MEMBER,
      subjectName: "Ana",
      occasion: "birthday",
      scope: "household",
      householdId,
    })
    .returning();
  if (!giftPlan) throw new Error("failed to seed gift plan");
  await db
    .insert(giftIdeas)
    .values({ giftPlanId: giftPlan.id, contributorUserId: OWNER, title: "a book" });

  await db.insert(memories).values({
    personId: person.id,
    ownerUserId: MEMBER,
    sourceRecordId: sharedSource.id,
    content: "likes hiking",
    scope: "household",
    householdId,
  });
  await db.insert(followups).values({
    personId: person.id,
    ownerUserId: MEMBER,
    reason: "check in",
    dueAt: new Date(),
    scope: "household",
    householdId,
  });

  // Reminders on both a household-native Saved Item (no foreign key to follow
  // once it is gone) and a household-native Action (which cascades).
  await db.insert(reminderSchedules).values([
    {
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: householdSavedItem.id,
      kind: "exact",
      timeZone: "UTC",
      occurrenceKey: `si-${randomUUID()}`,
      intendedAt: new Date(),
    },
    {
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: householdAction.id,
      generalActionId: householdAction.id,
      kind: "exact",
      timeZone: "UTC",
      occurrenceKey: `ga-${randomUUID()}`,
      intendedAt: new Date(),
    },
  ]);

  return {
    householdId,
    memberSavedItemId: memberSavedItem.id,
    memberActionId: memberAction.id,
    giftPlanId: giftPlan.id,
    groundingSourceId: groundingSource.id,
    sharedSourceId: sharedSource.id,
    personId: person.id,
  };
}

async function main() {
  const db = getDb();
  const dissolvedAt = new Date(Date.now() - 40 * DAY_MS);

  console.log("seeding a dissolved household with every family populated…");
  const seeded = await seedDissolvedHousehold(dissolvedAt);
  const { householdId } = seeded;

  console.log("running the sweep…");
  const result = await runHouseholdPurgeSweep({
    limit: 25,
    store: createDrizzleHouseholdPurgeStore(),
    logger: { info: () => {}, error: (message, context) => console.error(message, context) },
  });
  console.log("  sweep result:", result);

  console.log("\nthe workspace and everything it owned:");
  check(
    "workspace row is gone",
    (await db.select().from(householdWorkspaces).where(eq(householdWorkspaces.id, householdId)))
      .length === 0,
  );
  for (const [label, rows] of [
    [
      "household-native Saved Items",
      await db
        .select()
        .from(savedItems)
        .where(eq(savedItems.ownership, "household_native"))
        .then((all) => all.filter((row) => row.householdId === householdId)),
    ],
    [
      "memberships",
      await db
        .select()
        .from(householdMemberships)
        .where(eq(householdMemberships.householdId, householdId)),
    ],
    [
      "Event Plans",
      await db
        .select()
        .from(householdEventPlans)
        .where(eq(householdEventPlans.householdId, householdId)),
    ],
    [
      "household Context Facts",
      await db.select().from(contextFacts).where(eq(contextFacts.subjectHouseholdId, householdId)),
    ],
    [
      "Person References",
      await db.select().from(personReferences).where(eq(personReferences.householdId, householdId)),
    ],
    [
      "record shares",
      await db
        .select()
        .from(householdRecordShares)
        .where(eq(householdRecordShares.householdId, householdId)),
    ],
    [
      "invitations",
      await db
        .select()
        .from(householdInvitations)
        .where(eq(householdInvitations.householdId, householdId)),
    ],
    ["Assets", await db.select().from(assets).where(eq(assets.householdId, householdId))],
  ] as const) {
    check(`${label} are gone`, rows.length === 0, rows.length);
  }

  const orphanReminders = await db
    .select()
    .from(reminderSchedules)
    .where(eq(reminderSchedules.ownerUserId, OWNER))
    .then((rows) => rows.filter((row) => row.occurrenceKey.startsWith("si-")));
  check("Saved Item reminder schedules are cancelled", orphanReminders.length === 0);

  console.log("\nwhat the members kept:");
  const [memberItem] = await db
    .select()
    .from(savedItems)
    .where(eq(savedItems.id, seeded.memberSavedItemId));
  check(
    "member-owned Saved Item survives, private, unlinked",
    memberItem?.scope === "private" && memberItem?.householdId === null,
    memberItem,
  );
  const [memberActionRow] = await db
    .select()
    .from(generalActions)
    .where(eq(generalActions.id, seeded.memberActionId));
  check(
    "member-owned Action survives, private, unlinked",
    memberActionRow?.scope === "private" && memberActionRow?.householdId === null,
    memberActionRow,
  );
  const [plan] = await db.select().from(giftPlans).where(eq(giftPlans.id, seeded.giftPlanId));
  check(
    "member-owned Gift Plan survives, private, unlinked, fence bumped",
    plan?.scope === "private" && plan?.householdId === null && (plan?.revision ?? 0) > 0,
    plan,
  );
  const ideas = await db
    .select()
    .from(giftIdeas)
    .where(eq(giftIdeas.giftPlanId, seeded.giftPlanId));
  check("its ideas came with it", ideas.length === 1);
  const survivingSources = await db
    .select()
    .from(sourceRecords)
    .where(eq(sourceRecords.ownerUserId, MEMBER))
    .then((rows) =>
      rows.filter((row) => row.id === seeded.groundingSourceId || row.id === seeded.sharedSourceId),
    );
  check("both Source Records survive", survivingSources.length === 2, survivingSources.length);
  check(
    "both came home private with no household link",
    survivingSources.every((row) => row.scope === "private" && row.householdId === null),
    survivingSources.map((row) => ({ scope: row.scope, householdId: row.householdId })),
  );

  console.log("\nthe tombstone:");
  const [tombstone] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, householdId), eq(auditLog.action, "household.purge")));
  check("one tombstone was written", Boolean(tombstone));
  check("its actor is scrubbed", tombstone?.ownerUserId === null);
  console.log("  metadata:", tombstone?.metadataJson);

  const nullOwnerHouseholdNative = await db
    .select()
    .from(savedItems)
    .where(and(eq(savedItems.ownership, "household_native"), isNull(savedItems.householdId)));
  check(
    "no household-native Saved Item anywhere was left without a household",
    nullOwnerHouseholdNative.length === 0,
    nullOwnerHouseholdNative.length,
  );

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
