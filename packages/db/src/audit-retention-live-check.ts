/**
 * Live Postgres verification for audit-log retention.
 *
 * This uses the actual Drizzle store and sweep against the disposable local
 * database. Fixture ids are applied inside the candidate query before its
 * bounded production limit, so unrelated audit history cannot starve a check.
 *
 *   pnpm --filter @tendnote/db db:audit-retention:check
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { createDrizzleAuditLogRetentionStore } from "./queries/audit-retention/drizzle-store";
import { runAuditLogRetentionSweep } from "./queries/audit-retention/sweep";
import { auditLog } from "./schema";

// Keep the fixtures at stable exact boundaries so the live store also proves
// both directions of the leap-day cutoff calculation.
const runNow = new Date("2026-02-28T12:34:56.000Z");
const leapRunNow = new Date("2028-02-29T12:34:56.000Z");
const expiredId = randomUUID();
const boundaryId = randomUUID();
const currentId = randomUUID();
const leapSameClockId = randomUUID();
const leapLateId = randomUUID();
const leapCurrentId = randomUUID();
const unrelatedExpiredId = randomUUID();
const firstFixtureIds = [expiredId, boundaryId, currentId] as const;
const leapFixtureIds = [leapSameClockId, leapLateId, leapCurrentId] as const;
const fixtureIds = [
  expiredId,
  boundaryId,
  currentId,
  leapSameClockId,
  leapLateId,
  leapCurrentId,
] as const;
const cleanupIds = [...fixtureIds, unrelatedExpiredId] as const;

async function cleanup() {
  await getDb().delete(auditLog).where(inArray(auditLog.id, cleanupIds));
}

// fallow-ignore-next-line complexity -- This disposable Postgres contract keeps fixture setup, sweep execution, and cleanup assertions together so the real store behavior remains auditable in one place.
async function main() {
  await cleanup();

  await getDb()
    .insert(auditLog)
    .values([
      {
        id: unrelatedExpiredId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: unrelatedExpiredId,
        metadataJson: { fixture: false, adversarial: true },
        createdAt: new Date("2019-01-01T00:00:00.000Z"),
      },
      {
        id: expiredId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: expiredId,
        metadataJson: { fixture: true },
        createdAt: new Date("2024-02-29T12:34:56.000Z"),
      },
      {
        id: currentId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: currentId,
        metadataJson: { fixture: true },
        createdAt: runNow,
      },
      {
        id: boundaryId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: boundaryId,
        metadataJson: { fixture: true },
        createdAt: new Date("2024-02-28T12:34:56.001Z"),
      },
      {
        id: leapSameClockId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: leapSameClockId,
        metadataJson: { fixture: true },
        createdAt: new Date("2026-02-28T12:34:56.000Z"),
      },
      {
        id: leapLateId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: leapLateId,
        metadataJson: { fixture: true },
        createdAt: new Date("2026-02-28T23:59:59.999Z"),
      },
      {
        id: leapCurrentId,
        ownerUserId: null,
        action: "household.purge",
        entityType: "household",
        entityId: leapCurrentId,
        metadataJson: { fixture: true },
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);

  const isolateStore = (ids: readonly string[]) =>
    createDrizzleAuditLogRetentionStore(getDb, { candidateIds: ids });

  const store = isolateStore(firstFixtureIds);

  const first = await runAuditLogRetentionSweep({ limit: 1, now: runNow, store });
  if (first.scanned !== 1 || first.deleted !== 1 || first.skipped !== 0 || first.failed !== 0) {
    throw new Error(`unexpected first retention result: ${JSON.stringify(first)}`);
  }

  const second = await runAuditLogRetentionSweep({ limit: 1, now: runNow, store });
  if (second.scanned !== 0 || second.deleted !== 0 || second.skipped !== 0 || second.failed !== 0) {
    throw new Error(`unexpected repeat retention result: ${JSON.stringify(second)}`);
  }

  const firstRemaining = await getDb()
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(inArray(auditLog.id, firstFixtureIds));
  const firstRemainingIds = firstRemaining.map(({ id }) => id).sort();
  const expectedFirstRemainingIds = [boundaryId, currentId].sort();
  if (
    firstRemainingIds.length !== expectedFirstRemainingIds.length ||
    firstRemainingIds.some((id, index) => id !== expectedFirstRemainingIds[index])
  ) {
    throw new Error(`unexpected first fixture rows: ${JSON.stringify(firstRemaining)}`);
  }
  await getDb().delete(auditLog).where(inArray(auditLog.id, firstFixtureIds));

  const leapStore = isolateStore(leapFixtureIds);
  const leapFirst = await runAuditLogRetentionSweep({
    limit: 1,
    now: leapRunNow,
    store: leapStore,
  });
  if (
    leapFirst.scanned !== 1 ||
    leapFirst.deleted !== 1 ||
    leapFirst.skipped !== 0 ||
    leapFirst.failed !== 0
  ) {
    throw new Error(`unexpected leap first retention result: ${JSON.stringify(leapFirst)}`);
  }

  const leapSecond = await runAuditLogRetentionSweep({
    limit: 1,
    now: leapRunNow,
    store: leapStore,
  });
  if (
    leapSecond.scanned !== 1 ||
    leapSecond.deleted !== 1 ||
    leapSecond.skipped !== 0 ||
    leapSecond.failed !== 0
  ) {
    throw new Error(`unexpected leap second retention result: ${JSON.stringify(leapSecond)}`);
  }

  const leapRepeat = await runAuditLogRetentionSweep({
    limit: 1,
    now: leapRunNow,
    store: leapStore,
  });
  if (
    leapRepeat.scanned !== 0 ||
    leapRepeat.deleted !== 0 ||
    leapRepeat.skipped !== 0 ||
    leapRepeat.failed !== 0
  ) {
    throw new Error(`unexpected leap repeat retention result: ${JSON.stringify(leapRepeat)}`);
  }

  const remaining = await getDb()
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(inArray(auditLog.id, fixtureIds), eq(auditLog.entityType, "household")));
  const remainingIds = remaining.map(({ id }) => id).sort();
  const expectedRemainingIds = [leapCurrentId].sort();
  if (
    remainingIds.length !== expectedRemainingIds.length ||
    remainingIds.some((id, index) => id !== expectedRemainingIds[index])
  ) {
    throw new Error(`unexpected remaining fixture rows: ${JSON.stringify(remaining)}`);
  }

  const unrelatedRows = await getDb()
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.id, unrelatedExpiredId));
  if (unrelatedRows.length !== 1) {
    throw new Error(`unexpected unrelated fixture rows: ${JSON.stringify(unrelatedRows)}`);
  }

  console.log("Audit retention live check passed.");
}

try {
  await main();
} finally {
  await cleanup();
  await closeDb();
}
