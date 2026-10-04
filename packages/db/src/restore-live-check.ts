/**
 * Live Postgres verification for the restore tooling (#623).
 *
 * The in-memory restore cannot prove the parts that live in SQL: that an
 * account Deletion Record re-applies by deleting the account row and is absent
 * the second time; that each journaled Operator Action is found by its action
 * id in its own table, a lift only once the suspension carries it; that a
 * restored export job is matched to its fence by the same digest the processor
 * fences under; that copied email fences are found, counted, and swept; and
 * that a lost Operator Action is re-recorded under its journal id once (#723).
 *
 * It touches only its own fixtures, so it is safe on the shared development
 * database. The two global steps, ending every session and stopping writes to
 * the whole database, are exercised by the restore drill on an isolated branch.
 *
 *   pnpm --filter @tendnote/db db:restore:check
 */
import { randomUUID } from "node:crypto";
import { effectFenceDigest, ownerDataExportFenceKey } from "@tendnote/domain";
import { RETENTION } from "@tendnote/domain/retention";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { check, reportLiveCheckResult } from "./live-check";
import {
  countFencedUnfinishedExportJobs,
  findRecordedOperatorActions,
  isDeletionSubjectPresent,
  listAccountDeletionIntentRecords,
  markFencedExportJobs,
  reapplyDeletionRecord,
  rerecordRefund,
  rerecordSuspensionCredit,
  rerecordSuspensionLift,
  rerecordTermination,
} from "./queries/restore";
import {
  countRestoredEmailFences,
  isRestoredEmailFenced,
  recordRestoredEmailFences,
  sweepRestoredEmailFences,
} from "./queries/restored-email-fences";
import {
  accountDeletionIntents,
  legalHolds,
  ownerDataExportJobs,
  restoredEmailFences,
  suspensionCredits,
  temporarySuspensions,
  terminations,
  user,
} from "./schema";

const run = randomUUID().slice(0, 8);
const ids = {
  deleted: `restore-deleted-${run}`,
  owner: `restore-owner-${run}`,
  deleting: `restore-deleting-${run}`,
  heldDeleting: `restore-held-deleting-${run}`,
  rerecorded: `restore-rerecorded-${run}`,
};
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();

async function seed() {
  await getDb()
    .insert(user)
    .values(Object.values(ids).map((id) => ({ id, name: id, email: `${id}@example.invalid` })));
}

async function cleanup() {
  await getDb()
    .delete(user)
    .where(inArray(user.id, Object.values(ids)));
  await getDb()
    .delete(restoredEmailFences)
    .where(
      inArray(restoredEmailFences.digest, [
        effectFenceDigest(`fresh-${run}`),
        effectFenceDigest(`old-${run}`),
      ]),
    );
}

async function deletionRecords() {
  const record = {
    kind: "deletion" as const,
    subjectKind: "account" as const,
    subjectId: ids.deleted,
    at: NOW,
  };
  check("the restored account is present", await isDeletionSubjectPresent(record));
  const first = await reapplyDeletionRecord(record);
  check("re-applying its Deletion Record purges it", first.status === "purged", first);
  check("and it is gone", !(await isDeletionSubjectPresent(record)));
  const again = await reapplyDeletionRecord(record);
  check("re-applying it again finds it absent", again.status === "absent", again);
}

/** A committed deletion is journaled at stop-writes, unless a Legal Hold covers it (#632). */
async function deletionIntents() {
  await getDb()
    .insert(accountDeletionIntents)
    .values([
      { userId: ids.deleting, requestedAt: NOW },
      { userId: ids.heldDeleting, requestedAt: NOW },
    ]);
  await getDb()
    .insert(legalHolds)
    .values({ userId: ids.heldDeleting, expiresAt: new Date(NOW.getTime() + DAY) });
  const { records, heldAccountIds } = await listAccountDeletionIntentRecords({ now: NOW });
  const journaled = records.map((record) => record.subjectId);
  check(
    "an unheld intent gets its Deletion Record, and a held one is listed instead",
    journaled.includes(ids.deleting) &&
      !journaled.includes(ids.heldDeleting) &&
      heldAccountIds.includes(ids.heldDeleting) &&
      !heldAccountIds.includes(ids.deleting),
    { journaled, heldAccountIds },
  );
}

async function operatorActions() {
  const [open] = await getDb()
    .insert(temporarySuspensions)
    .values({
      userId: ids.owner,
      reason: "live check",
      reviewDeadline: new Date(NOW.getTime() + DAY),
    })
    .returning({ id: temporarySuspensions.id });
  const id = open?.id as string;
  const missing = randomUUID();

  const suspensions = await findRecordedOperatorActions({
    kind: "suspension",
    actionIds: [id, missing, "not-a-uuid"],
  });
  check(
    "a suspension is found by its action id, and only it",
    suspensions.size === 1 && suspensions.has(id),
    suspensions,
  );
  await suspensionLifts(id);
}

/** A lift is on record only once the suspension carries it; a Legal Hold is its own row. */
async function suspensionLifts(id: string) {
  const unlifted = await findRecordedOperatorActions({ kind: "suspension-lift", actionIds: [id] });
  check("an unlifted suspension is no lift on record", unlifted.size === 0, unlifted);

  await getDb()
    .update(temporarySuspensions)
    .set({ liftedAt: NOW })
    .where(eq(temporarySuspensions.id, id));
  const lifted = await findRecordedOperatorActions({ kind: "suspension-lift", actionIds: [id] });
  check("once lifted, the lift is on record", lifted.has(id), lifted);

  const [held] = await getDb()
    .insert(legalHolds)
    .values({ userId: ids.owner, expiresAt: new Date(NOW.getTime() + DAY) })
    .returning({ id: legalHolds.id });
  const holds = await findRecordedOperatorActions({
    kind: "legal-hold",
    actionIds: [held?.id as string, id],
  });
  check(
    "a Legal Hold is found by its action id, and a suspension's id is not one",
    holds.size === 1 && holds.has(held?.id as string),
    holds,
  );
}

/**
 * A lost termination, lift, refund, and Suspension Credit go back in under
 * their journal ids, once, and are then found as on record (#723).
 */
async function rerecordedOperatorActions() {
  const db = getDb();
  const [open] = await db
    .insert(temporarySuspensions)
    .values({
      userId: ids.rerecorded,
      reason: "live check",
      suspendedAt: new Date(NOW.getTime() - DAY),
      reviewDeadline: new Date(NOW.getTime() + DAY),
    })
    .returning({ id: temporarySuspensions.id });
  const suspensionId = open?.id as string;
  const termination = {
    id: randomUUID(),
    userId: ids.rerecorded,
    reason: "live check",
    terminatedAt: NOW,
    retentionDeadline: new Date(NOW.getTime() + DAY),
  };

  check("a lost termination is re-recorded", await rerecordTermination(termination));
  check("and not twice", !(await rerecordTermination(termination)));
  const [row] = await db
    .select({ suspensionId: terminations.suspensionId, terminatedAt: terminations.terminatedAt })
    .from(terminations)
    .where(eq(terminations.id, termination.id));
  check(
    "it converts the suspension open before it, at its own time",
    row?.suspensionId === suspensionId && row.terminatedAt.getTime() === NOW.getTime(),
    row,
  );
  check(
    "no termination is written for an account that is gone",
    !(await rerecordTermination({ ...termination, id: randomUUID(), userId: `gone-${run}` })),
  );

  const lift = { id: suspensionId, userId: ids.rerecorded, liftedAt: NOW };
  check("a lost lift is re-recorded on its open suspension", await rerecordSuspensionLift(lift));
  check("and not twice", !(await rerecordSuspensionLift(lift)));
  const lifts = await findRecordedOperatorActions({
    kind: "suspension-lift",
    actionIds: [lift.id],
  });
  check("the lift is then on record", lifts.has(lift.id), lifts);

  await rerecordedMoney(termination.id);
}

async function rerecordedMoney(terminationId: string) {
  const refund = {
    id: randomUUID(),
    userId: ids.rerecorded,
    stripeSubscriptionId: `sub_${run}`,
    invoiceId: `in_${run}`,
    paymentIntentId: `pi_${run}`,
    amount: 2000,
    requestedAt: NOW,
    stripeRefundId: `re_${run}`,
    revokedAt: null,
  };
  check("a lost refund is re-recorded", await rerecordRefund(refund));
  check("and not twice", !(await rerecordRefund(refund)));
  const refunds = await findRecordedOperatorActions({ kind: "refund", actionIds: [refund.id] });
  check("the refund is then on record", refunds.has(refund.id), refunds);

  // Another account's suspension: held, but not this account's to name.
  const [others] = await getDb()
    .insert(temporarySuspensions)
    .values({ userId: ids.owner, reason: "live check", reviewDeadline: NOW })
    .returning({ id: temporarySuspensions.id });
  const credit = {
    id: randomUUID(),
    userId: ids.rerecorded,
    suspensionId: others?.id as string,
    terminationId,
    stripeSubscriptionId: `sub_${run}`,
    invoiceId: `in_${run}`,
    invoiceLineItemId: `il_${run}`,
    paymentIntentId: `pi_${run}`,
    suspendedAmount: 300,
    remainderAmount: 750,
    amount: 1155,
    instrument: "card" as const,
    requestedAt: NOW,
    stripeCreditNoteId: `cn_${run}`,
    stripeRefundId: `re_cn_${run}`,
  };
  check("a lost Suspension Credit is re-recorded", await rerecordSuspensionCredit(credit));
  check("and not twice", !(await rerecordSuspensionCredit(credit)));
  const [stored] = await getDb()
    .select({
      suspensionId: suspensionCredits.suspensionId,
      terminationId: suspensionCredits.terminationId,
    })
    .from(suspensionCredits)
    .where(eq(suspensionCredits.id, credit.id));
  check(
    "it keeps its own termination, and stores another account's suspension as none",
    stored?.terminationId === terminationId && stored.suspensionId === null,
    stored,
  );
}

async function exportJobs() {
  const keys = { delivered: `delivered-${run}`, pending: `pending-${run}`, done: `done-${run}` };
  await getDb()
    .insert(ownerDataExportJobs)
    .values([
      { ownerUserId: ids.owner, idempotencyKey: keys.delivered, status: "running" },
      { ownerUserId: ids.owner, idempotencyKey: keys.pending, status: "pending" },
      { ownerUserId: ids.owner, idempotencyKey: keys.done, status: "completed" },
    ]);
  const fencedAt = new Date(NOW.getTime() - 60_000);
  const digest = (key: string) =>
    effectFenceDigest(ownerDataExportFenceKey({ ownerUserId: ids.owner, idempotencyKey: key }));
  const fences = [keys.delivered, keys.done].map((key) => ({ digest: digest(key), fencedAt }));

  check(
    "one unfinished job is named by a fence",
    (await countFencedUnfinishedExportJobs(fences.map((fence) => fence.digest))) === 1,
  );
  const marked = await markFencedExportJobs(fences);
  check("marking fences marks exactly that job", marked === 1, marked);
  await checkMarkedExportJobs(keys, fencedAt);
  check("marking again marks nothing", (await markFencedExportJobs(fences)) === 0);
}

/** What marking left each job as, read back by its key. */
async function checkMarkedExportJobs(
  keys: { delivered: string; pending: string; done: string },
  fencedAt: Date,
) {
  const rows = await getDb()
    .select({
      key: ownerDataExportJobs.idempotencyKey,
      status: ownerDataExportJobs.status,
      completedAt: ownerDataExportJobs.completedAt,
    })
    .from(ownerDataExportJobs)
    .where(eq(ownerDataExportJobs.ownerUserId, ids.owner));
  // Each job read back as `status@completedAt`, so one comparison checks both.
  const byKey = new Map(
    rows.map((row) => [row.key, `${row.status}@${row.completedAt?.toISOString() ?? "-"}`]),
  );
  check(
    "the delivered job ends expired as of its fence",
    byKey.get(keys.delivered) === `expired@${fencedAt.toISOString()}`,
    byKey.get(keys.delivered),
  );
  check("an unfenced job is left to run", byKey.get(keys.pending) === "pending@-");
  check("a finished job is left alone", byKey.get(keys.done) === "completed@-");
}

async function emailFences() {
  const fresh = effectFenceDigest(`fresh-${run}`);
  const old = effectFenceDigest(`old-${run}`);
  const expiredAt = new Date(NOW.getTime() - RETENTION.effectFence.days * DAY - 1);
  await recordRestoredEmailFences([
    { digest: fresh, fencedAt: NOW },
    { digest: old, fencedAt: expiredAt },
  ]);
  await recordRestoredEmailFences([{ digest: fresh, fencedAt: NOW }]);

  check("a copied fence is found by its digest", await isRestoredEmailFenced({ digest: fresh }));
  check(
    "copying again adds nothing, and both are counted",
    (await countRestoredEmailFences([fresh, old, effectFenceDigest(`other-${run}`)])) === 2,
  );
  await sweepRestoredEmailFences({ now: NOW });
  check(
    "the sweep removes a fence past retention",
    !(await isRestoredEmailFenced({ digest: old })),
  );
  check("and keeps one inside it", await isRestoredEmailFenced({ digest: fresh }));
}

try {
  await seed();
  await deletionRecords();
  await deletionIntents();
  await operatorActions();
  await rerecordedOperatorActions();
  await exportJobs();
  await emailFences();
} finally {
  await cleanup();
  await closeDb();
}
reportLiveCheckResult();
