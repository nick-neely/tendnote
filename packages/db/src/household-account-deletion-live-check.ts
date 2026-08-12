/**
 * Destructive Postgres contract for Household-aware account deletion.
 *
 * Seeds isolated throwaway users and workspaces, deletes the creator account,
 * proves member-owned roots disappear, Household-native roots and history stay,
 * and verifies only the surviving member can read the retained Action.
 *
 *   pnpm --filter @tendnote/db db:account-deletion:check
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { createDrizzleGeneralActionStore } from "./queries/general-actions/drizzle-store";
import {
  assetAuditEvents,
  assetEvidence,
  assetEvidenceFiles,
  assetMemories,
  assets,
  auditLog,
  generalActionEvents,
  generalActions,
  householdInvitations,
  householdMemberships,
  householdWorkspaces,
  user,
} from "./schema";

const run = randomUUID();
const creatorId = `delete-creator-${run}`;
const survivorId = `delete-survivor-${run}`;
const outsiderId = `delete-outsider-${run}`;
const soleId = `delete-sole-${run}`;

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`  ok   ${label}`);
}

async function seedUser(id: string) {
  await getDb()
    .insert(user)
    .values({ id, name: id, email: `${id}@example.invalid` });
}

async function cleanupTestArtifacts() {
  const households = await getDb()
    .select({ id: householdWorkspaces.id })
    .from(householdWorkspaces)
    .where(eq(householdWorkspaces.name, `Account deletion ${run}`));
  const householdIds = households.map((household) => household.id);
  if (householdIds.length > 0) {
    await getDb().delete(generalActions).where(inArray(generalActions.householdId, householdIds));
    await getDb().delete(assets).where(inArray(assets.householdId, householdIds));
    await getDb().delete(householdWorkspaces).where(inArray(householdWorkspaces.id, householdIds));
  }
  for (const id of [creatorId, survivorId, outsiderId, soleId]) {
    await getDb().delete(user).where(eq(user.id, id));
  }
}

// fallow-ignore-next-line complexity -- This destructive integration fixture spells the complete persisted membership states inline so its database arrangement remains auditable beside the assertions.
async function seedHousehold(input: {
  ownerUserId: string;
  otherOwnerUserId?: string;
  dissolved?: boolean;
}) {
  const [household] = await getDb()
    .insert(householdWorkspaces)
    .values({
      ownerUserId: input.ownerUserId,
      name: `Account deletion ${run}`,
      status: input.dissolved ? "dissolved" : "active",
      dissolvedAt: input.dissolved ? new Date() : null,
    })
    .returning();
  if (!household) throw new Error("Failed to seed household.");
  await getDb()
    .insert(householdMemberships)
    .values([
      {
        householdId: household.id,
        userId: input.ownerUserId,
        invitedByUserId: input.ownerUserId,
        role: "owner",
        status: input.dissolved ? "removed" : "active",
        removedAt: input.dissolved ? new Date() : null,
      },
      ...(input.otherOwnerUserId
        ? [
            {
              householdId: household.id,
              userId: input.otherOwnerUserId,
              invitedByUserId: input.ownerUserId,
              role: "owner" as const,
              status: "active" as const,
              acceptedAt: new Date(),
            },
          ]
        : []),
    ]);
  return household.id;
}

// fallow-ignore-next-line complexity -- This destructive integration fixture intentionally seeds the retained parent-child graph in one ordered database setup rather than hiding the contract across helpers.
async function seedRecordFamilies(householdId: string, ownerUserId: string) {
  const [householdAction, memberAction] = await getDb()
    .insert(generalActions)
    .values([
      {
        ownerUserId,
        ownership: "household_native",
        title: `Household action ${run}`,
        scope: "household",
        householdId,
      },
      { ownerUserId, ownership: "member_owned", title: `Private action ${run}` },
    ])
    .returning();
  if (!householdAction || !memberAction) throw new Error("Failed to seed actions.");
  await getDb().insert(generalActionEvents).values({
    generalActionId: householdAction.id,
    ownerUserId,
    kind: "created",
    actorUserId: ownerUserId,
  });

  const [householdAsset, memberAsset] = await getDb()
    .insert(assets)
    .values([
      {
        ownerUserId,
        name: `Household asset ${run}`,
        kind: "item",
        ownership: "household_native",
        scope: "household",
        householdId,
      },
      { ownerUserId, name: `Private asset ${run}`, kind: "item", ownership: "member_owned" },
    ])
    .returning();
  if (!householdAsset || !memberAsset) throw new Error("Failed to seed assets.");
  await getDb().insert(assetAuditEvents).values({
    assetId: householdAsset.id,
    ownerUserId,
    kind: "created",
    actorUserId: ownerUserId,
    source: "user",
    scope: "household",
  });
  await getDb().insert(assetMemories).values({
    assetId: householdAsset.id,
    ownerUserId,
    label: "Filter size",
    notes: "20x20",
    status: "active",
    ownership: "household_native",
    scope: "household",
    householdId,
  });
  const [evidence] = await getDb()
    .insert(assetEvidence)
    .values({
      assetId: householdAsset.id,
      ownerUserId,
      kind: "note",
      label: "Manual note",
      capturedText: "Retained evidence",
      ownership: "household_native",
      scope: "household",
      householdId,
    })
    .returning();
  if (!evidence) throw new Error("Failed to seed evidence.");
  await getDb()
    .insert(assetEvidenceFiles)
    .values({
      evidenceId: evidence.id,
      ownerUserId,
      bytes: new Uint8Array([1, 2, 3]),
    });
  return { householdAction, memberAction, householdAsset, memberAsset };
}

// fallow-ignore-next-line complexity -- This executable is a linear destructive Postgres contract whose ordered setup, deletion, and assertions must stay visible together; it is exercised directly against a fresh migrated database.
async function main() {
  await cleanupTestArtifacts();
  for (const id of [creatorId, survivorId, outsiderId, soleId]) await seedUser(id);

  const sharedHouseholdId = await seedHousehold({
    ownerUserId: creatorId,
    otherOwnerUserId: survivorId,
  });
  const shared = await seedRecordFamilies(sharedHouseholdId, creatorId);
  await getDb().delete(user).where(eq(user.id, creatorId));

  const retainedActions = await getDb()
    .select()
    .from(generalActions)
    .where(eq(generalActions.householdId, sharedHouseholdId));
  check(
    "member-owned action was deleted",
    !(
      await getDb()
        .select()
        .from(generalActions)
        .where(eq(generalActions.id, shared.memberAction.id))
    ).length,
  );
  check(
    "household-native action survived",
    retainedActions.some((row) => row.id === shared.householdAction.id),
  );
  check(
    "household-native action key moved to survivor",
    retainedActions[0]?.ownerUserId === survivorId,
  );
  check(
    "member-owned asset was deleted",
    !(await getDb().select().from(assets).where(eq(assets.id, shared.memberAsset.id))).length,
  );
  check(
    "household-native asset survived",
    (await getDb().select().from(assets).where(eq(assets.id, shared.householdAsset.id))).length ===
      1,
  );
  check(
    "household-native action history survived",
    (
      await getDb()
        .select()
        .from(generalActionEvents)
        .where(eq(generalActionEvents.generalActionId, shared.householdAction.id))
    ).length === 1,
  );

  const actionStore = createDrizzleGeneralActionStore();
  const survivorVisible = await actionStore.listVisibleGeneralActionsForCaller({
    callerUserId: survivorId,
  });
  const outsiderVisible = await actionStore.listVisibleGeneralActionsForCaller({
    callerUserId: outsiderId,
  });
  check(
    "surviving member can read retained household action",
    survivorVisible.some((row) => row.id === shared.householdAction.id),
  );
  check(
    "unrelated user cannot read retained household action",
    !outsiderVisible.some((row) => row.id === shared.householdAction.id),
  );

  const soleHouseholdId = await seedHousehold({ ownerUserId: soleId });
  const secondSoleHouseholdId = await seedHousehold({ ownerUserId: soleId });
  const sole = await seedRecordFamilies(soleHouseholdId, soleId);
  const [pendingInvitation, secondPendingInvitation] = await getDb()
    .insert(householdInvitations)
    .values([
      {
        householdId: soleHouseholdId,
        invitedByUserId: soleId,
        email: `pending-${run}@example.invalid`,
        normalizedEmail: `pending-${run}@example.invalid`,
        secretDigest: `pending-${run}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        householdId: secondSoleHouseholdId,
        invitedByUserId: soleId,
        email: `pending-second-${run}@example.invalid`,
        normalizedEmail: `pending-second-${run}@example.invalid`,
        secretDigest: `pending-second-${run}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])
    .returning();
  if (!pendingInvitation || !secondPendingInvitation) {
    throw new Error("Failed to seed pending invitations.");
  }
  await getDb().delete(user).where(eq(user.id, soleId));
  check(
    "sole-member dissolved household action survived",
    (
      await getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.id, sole.householdAction.id),
            eq(generalActions.ownerUserId, soleId),
          ),
        )
    ).length === 1,
  );
  check(
    "sole-member dissolved household asset survived",
    (
      await getDb()
        .select()
        .from(assets)
        .where(and(eq(assets.id, sole.householdAsset.id), eq(assets.ownerUserId, soleId)))
    ).length === 1,
  );
  const dissolvedWorkspaces = await getDb()
    .select({ status: householdWorkspaces.status })
    .from(householdWorkspaces)
    .where(inArray(householdWorkspaces.id, [soleHouseholdId, secondSoleHouseholdId]));
  check(
    "every sole-member workspace entered dissolution recovery atomically",
    dissolvedWorkspaces.length === 2 &&
      dissolvedWorkspaces.every((workspace) => workspace.status === "dissolved"),
  );
  const canceledInvitations = await getDb()
    .select({ state: householdInvitations.state })
    .from(householdInvitations)
    .where(inArray(householdInvitations.id, [pendingInvitation.id, secondPendingInvitation.id]));
  check(
    "every sole-member dissolution canceled pending invitations",
    canceledInvitations.length === 2 &&
      canceledInvitations.every((invitation) => invitation.state === "canceled"),
  );
  const dissolutionAuditEntries = await getDb()
    .select({ ownerUserId: auditLog.ownerUserId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "household.dissolve"),
        inArray(auditLog.entityId, [soleHouseholdId, secondSoleHouseholdId]),
      ),
    );
  check(
    "sole-member dissolution retained a minimized audit event for every workspace",
    dissolutionAuditEntries.length === 2 &&
      dissolutionAuditEntries.every((entry) => entry.ownerUserId === null),
  );
}

try {
  await main();
  console.log("Household account-deletion live check passed.");
} finally {
  await cleanupTestArtifacts();
  await closeDb();
}
