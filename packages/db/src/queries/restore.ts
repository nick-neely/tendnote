import {
  type DeletionRecord,
  effectFenceDigest,
  type OperatorRecordKind,
  ownerDataExportFenceKey,
  type RestoredFence,
} from "@tendnote/domain";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "../client";
import {
  accountCeilingOverrides,
  accountDeletionIntents,
  admissionExceptions,
  legalHolds,
  ownerDataExportJobs,
  refundRecords,
  session,
  suspensionCredits,
  temporarySuspensions,
  terminations,
  user,
} from "../schema";
import { createDrizzleHouseholdPurgeStore } from "./households/drizzle-purge-store";
import { reapplyHouseholdDeletionRecord } from "./households/purge";
import { heldBeyond } from "./legal-holds";

/**
 * The restored database's side of the restore procedure (#623, ADR 0250). Run
 * by the operator's restore tool against whichever branch `DATABASE_URL`
 * names; nothing in the product calls it.
 */

/**
 * Re-applies one Deletion Record through its kind's own purge path. An account
 * goes the way every account deletion goes, by deleting its row and letting the
 * database's household-aware disposition decide what stays with a Household; a
 * household goes through the ADR 0221 erasure. Idempotent: a subject already
 * gone is `absent`.
 */
export async function reapplyDeletionRecord(
  record: DeletionRecord,
): Promise<{ status: "purged" | "absent" }> {
  if (record.subjectKind === "household") {
    return reapplyHouseholdDeletionRecord({ record, store: createDrizzleHouseholdPurgeStore() });
  }
  const deleted = await getDb()
    .delete(user)
    .where(eq(user.id, record.subjectId))
    .returning({ id: user.id });
  return { status: deleted.length > 0 ? "purged" : "absent" };
}

/**
 * The Deletion Record every committed account deletion intent stands for,
 * journaled or not, timed at its request exactly as the deletion path times
 * it. Read from production once writes stop, so a deletion whose journal write
 * had not yet succeeded is journaled before its intent is lost to the swap.
 *
 * An intent under a Legal Hold at `now` gets no record, because a restore
 * would re-apply it and purge held data (#632). Its account is listed instead,
 * for the operator to commit its intent again in the restored data.
 */
export async function listAccountDeletionIntentRecords(input: {
  now: Date;
}): Promise<{ records: DeletionRecord[]; heldAccountIds: string[] }> {
  const intents = await getDb()
    .select({
      userId: accountDeletionIntents.userId,
      requestedAt: accountDeletionIntents.requestedAt,
      held: heldBeyond(accountDeletionIntents.userId, input.now).mapWith(Boolean),
    })
    .from(accountDeletionIntents);
  return {
    records: intents
      .filter((intent) => !intent.held)
      .map((intent) => ({
        kind: "deletion",
        subjectKind: "account",
        subjectId: intent.userId,
        at: intent.requestedAt,
      })),
    heldAccountIds: intents.filter((intent) => intent.held).map((intent) => intent.userId),
  };
}

/** Whether a Deletion Record's subject is still in the database, for verification. */
export async function isDeletionSubjectPresent(record: DeletionRecord): Promise<boolean> {
  if (record.subjectKind === "household") {
    const store = createDrizzleHouseholdPurgeStore();
    return (await store.findHousehold({ householdId: record.subjectId })) !== null;
  }
  const [row] = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, record.subjectId))
    .limit(1);
  return Boolean(row);
}

/**
 * Where each journaled Operator Action keeps its record, by the action id the
 * journal names. A lift is the suspension row once it carries its lift.
 */
const OPERATOR_ACTION_RECORDS: Record<
  OperatorRecordKind,
  { table: PgTable; id: PgColumn; recorded?: PgColumn }
> = {
  suspension: { table: temporarySuspensions, id: temporarySuspensions.id },
  "suspension-lift": {
    table: temporarySuspensions,
    id: temporarySuspensions.id,
    recorded: temporarySuspensions.liftedAt,
  },
  termination: { table: terminations, id: terminations.id },
  "legal-hold": { table: legalHolds, id: legalHolds.id },
  grant: { table: admissionExceptions, id: admissionExceptions.id },
  refund: { table: refundRecords, id: refundRecords.id },
  "suspension-credit": { table: suspensionCredits, id: suspensionCredits.id },
  "ceiling-override": { table: accountCeilingOverrides, id: accountCeilingOverrides.id },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which of these journaled action ids the restored database holds a record
 * for. An id that is not a record id at all is never held.
 */
export async function findRecordedOperatorActions(input: {
  kind: OperatorRecordKind;
  actionIds: string[];
}): Promise<Set<string>> {
  const source = OPERATOR_ACTION_RECORDS[input.kind];
  const ids = input.actionIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: source.id })
    .from(source.table)
    .where(
      source.recorded
        ? and(inArray(source.id, ids), isNotNull(source.recorded))
        : inArray(source.id, ids),
    );
  return new Set(rows.map((row) => String(row.id)));
}

const UNFINISHED_EXPORT = ["pending", "running", "failed"] as const;

async function listFencedUnfinishedExportJobs(digests: Set<string>) {
  const unfinished = await getDb()
    .select({
      id: ownerDataExportJobs.id,
      ownerUserId: ownerDataExportJobs.ownerUserId,
      idempotencyKey: ownerDataExportJobs.idempotencyKey,
    })
    .from(ownerDataExportJobs)
    .where(inArray(ownerDataExportJobs.status, [...UNFINISHED_EXPORT]));
  return unfinished
    .map((job) => ({
      id: job.id,
      digest: effectFenceDigest(ownerDataExportFenceKey(job)),
    }))
    .filter((job) => digests.has(job.digest));
}

/**
 * Marks every restored export job a fence says was already delivered (#620).
 * Its archive left before the restore and its bytes went with the rolled-back
 * rows, so the job becomes `expired` as of its fence, exactly as a delivered
 * export ends: the owner sees it done and can ask for a new one. Safe to repeat.
 */
export async function markFencedExportJobs(fences: RestoredFence[]): Promise<number> {
  const fencedAt = new Map(fences.map((fence) => [fence.digest, fence.fencedAt]));
  const jobs = await listFencedUnfinishedExportJobs(new Set(fencedAt.keys()));
  for (const job of jobs) {
    const at = fencedAt.get(job.digest) as Date;
    await getDb()
      .update(ownerDataExportJobs)
      .set({
        status: "expired",
        completedAt: at,
        artifactExpiresAt: at,
        claimedAt: null,
        claimToken: null,
        updatedAt: new Date(),
      })
      .where(eq(ownerDataExportJobs.id, job.id));
  }
  return jobs.length;
}

/** How many unfinished export jobs a fence still names, for verification. */
export async function countFencedUnfinishedExportJobs(digests: string[]): Promise<number> {
  return (await listFencedUnfinishedExportJobs(new Set(digests))).length;
}

/** Deletes every session row in the auth store. */
export async function deleteAllSessions(): Promise<number> {
  return (await getDb().delete(session).returning({ id: session.id })).length;
}

export async function countSessions(): Promise<number> {
  const [row] = await getDb().select({ count: sql<number>`count(*)::int` }).from(session);
  return row?.count ?? 0;
}

/**
 * Stops or resumes writes to the whole database: every new connection starts
 * read-only. Existing connections keep their mode, which is why stopping also
 * ends them. The change runs in an explicitly read-write transaction, because
 * once writes are stopped the connection resuming them starts read-only too.
 */
export async function setDatabaseWritesStopped(stopped: boolean): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set transaction read write`);
    await tx.execute(
      stopped
        ? sql`do $$ begin execute format('alter database %I set default_transaction_read_only = on', current_database()); end $$`
        : sql`do $$ begin execute format('alter database %I reset default_transaction_read_only', current_database()); end $$`,
    );
  });
}

/** Whether new connections to this database start read-only, read from the catalog. */
export async function areDatabaseWritesStopped(): Promise<boolean> {
  const rows = await getDb().execute<{ stopped: boolean }>(sql`
    select coalesce(bool_or('default_transaction_read_only=on' = any(setconfig)), false) as stopped
    from pg_db_role_setting
    where setrole = 0
      and setdatabase = (select oid from pg_database where datname = current_database())
  `);
  return Boolean(rows[0]?.stopped);
}

/**
 * Ends every other connection this database role holds, so each reconnects
 * read-only. Only the role's own: the platform's administrative connections
 * are not the product's, and ending one may be refused. The others are chosen
 * first, in a materialized step, because a plain `where` may call the
 * terminate before filtering out this connection.
 */
export async function endOtherConnections(): Promise<number> {
  const rows = await getDb().execute<{ ended: number }>(sql`
    with others as materialized (
      select pid
      from pg_stat_activity
      where datname = current_database()
        and usename = current_user
        and pid <> pg_backend_pid()
        and backend_type = 'client backend'
    )
    select (count(*) filter (where pg_terminate_backend(pid)))::int as ended from others
  `);
  return rows[0]?.ended ?? 0;
}
