/**
 * Live Postgres verification for the retention-deadline sweep (#621).
 *
 * The in-memory store cannot prove the parts that live in SQL: which accounts
 * the due query selects (a notice keyed to an older deadline does not count, a
 * terminated account is read by its termination's deadline, an account already
 * being deleted is skipped, an account under a Legal Hold is skipped until the
 * hold ends), and that the purge claim commits nothing once the account
 * resubscribed or was held. The deletion store's own reading of a hold, which
 * keeps a held intent out of the recovery sweep, is checked here too. The
 * last check runs a purge end to end through the real account-deletion store
 * and confirms the account is gone and confirmed.
 *
 *   pnpm --filter @tendnote/db db:account-retention:check
 */
import { randomUUID } from "node:crypto";
import { lapsedRetentionDeadline } from "@tendnote/domain";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { check, reportLiveCheckResult } from "./live-check";
import { createDrizzleAccountDeletionStore } from "./queries/account-deletion/drizzle-store";
import { createInMemoryRecoveryJournal } from "./queries/account-deletion/in-memory-journal";
import { requestAccountDeletion } from "./queries/account-deletion/service";
import { createDrizzleAccountRetentionStore } from "./queries/account-retention/drizzle-store";
import { runAccountRetentionSweep } from "./queries/account-retention/service";
import {
  accessProfiles,
  accountDeletionIntents,
  deletionNotices,
  legalHolds,
  terminations,
  user,
} from "./schema";

const DAY = 24 * 60 * 60 * 1000;
// Far enough out that no real account's deadline can interleave with the fixtures.
const lapsedAt = new Date("2099-01-01T12:00:00.000Z");
const deadline = lapsedRetentionDeadline(lapsedAt);
const day = (n: number) => new Date(lapsedAt.getTime() + n * DAY);

const run = randomUUID().slice(0, 8);
const ids = {
  fresh: `retention-fresh-${run}`,
  notified: `retention-notified-${run}`,
  staleNotice: `retention-stale-${run}`,
  admitted: `retention-admitted-${run}`,
  terminated: `retention-terminated-${run}`,
  deleting: `retention-deleting-${run}`,
  held: `retention-held-${run}`,
  heldTerminated: `retention-held-terminated-${run}`,
  heldDeleting: `retention-held-deleting-${run}`,
};
const fixtureIds = Object.values(ids);

async function seed() {
  await getDb()
    .insert(user)
    .values(fixtureIds.map((id) => ({ id, name: id, email: `${id}@example.invalid` })));
  const lapsed = (userId: string, retentionDeadline: Date | null, status = "pending" as const) => ({
    userId,
    status,
    retentionDeadline,
  });
  await getDb()
    .insert(accessProfiles)
    .values([
      lapsed(ids.fresh, deadline),
      lapsed(ids.notified, deadline),
      lapsed(ids.staleNotice, deadline),
      { userId: ids.admitted, status: "granted", source: "paid_access", grantedAt: day(0) },
      // A terminated account whose subscription later ended: the Lapsed
      // projection wrote a later deadline that must never be acted on.
      lapsed(ids.terminated, new Date(deadline.getTime() + 30 * DAY)),
      lapsed(ids.deleting, deadline),
      lapsed(ids.held, deadline),
      lapsed(ids.heldDeleting, deadline),
    ]);
  await getDb()
    .insert(terminations)
    .values(
      [ids.terminated, ids.heldTerminated].map((userId) => ({
        userId,
        reason: "live check",
        terminatedAt: lapsedAt,
        retentionDeadline: deadline,
      })),
    );
  // Held past the deadline, until day 120.
  await getDb()
    .insert(legalHolds)
    .values(
      [ids.held, ids.heldTerminated, ids.heldDeleting].map((userId) => ({
        userId,
        expiresAt: day(120),
        placedAt: day(0),
      })),
    );
  await getDb()
    .insert(deletionNotices)
    .values([
      { userId: ids.notified, retentionDeadline: deadline, stage: "day_0", sentAt: day(0) },
      {
        userId: ids.staleNotice,
        retentionDeadline: new Date(deadline.getTime() - 200 * DAY),
        stage: "day_83",
        sentAt: day(-120),
      },
    ]);
  await getDb()
    .insert(accountDeletionIntents)
    .values([
      { userId: ids.deleting, requestedAt: day(0) },
      { userId: ids.heldDeleting, requestedAt: day(0) },
    ]);
}

/** A Legal Hold pauses the notices and the purge until it ends, and keeps a held intent waiting (#632). */
async function legalHoldsPause() {
  const held = [ids.held, ids.heldTerminated];
  for (const n of [1, 60, 90, 119]) {
    const listed = (await dueAt(day(n))).map((account) => account.userId);
    check(
      `day ${n}: a held account is owed no notice and no purge`,
      !held.some((id) => listed.includes(id)),
      listed,
    );
  }
  check(
    "no purge is claimed for a held account past its deadline",
    !(await store.claimPurge({ userId: ids.held, retentionDeadline: deadline, now: day(90) })) &&
      !(await store.claimPurge({
        userId: ids.heldTerminated,
        retentionDeadline: deadline,
        now: day(90),
      })),
  );
  const afterHold = (await dueAt(day(120))).map((account) => account.userId);
  check(
    "day 120: once the hold ends, both are due again",
    held.every((id) => afterHold.includes(id)),
    afterHold,
  );

  const deletionStore = createDrizzleAccountDeletionStore();
  const listedIntents = async (now: Date) =>
    (await deletionStore.listIntents({ limit: 1000, now })).map((intent) => intent.userId);
  check(
    "a held intent waits out of the recovery sweep, beside one that is not held",
    (await deletionStore.isHeld({ userId: ids.heldDeleting, now: day(1) })) &&
      !(await deletionStore.isHeld({ userId: ids.deleting, now: day(1) })) &&
      !(await listedIntents(day(1))).includes(ids.heldDeleting) &&
      (await listedIntents(day(1))).includes(ids.deleting),
  );
  check(
    "a held intent is listed again once the hold ends",
    !(await deletionStore.isHeld({ userId: ids.heldDeleting, now: day(120) })) &&
      (await listedIntents(day(120))).includes(ids.heldDeleting),
  );
}

async function cleanup() {
  await getDb().delete(user).where(inArray(user.id, fixtureIds));
}

const store = createDrizzleAccountRetentionStore();

async function dueAt(now: Date) {
  const due = await store.listDue({ now, limit: 1000 });
  return due.filter((account) => fixtureIds.includes(account.userId));
}

// fallow-ignore-next-line complexity -- This disposable Postgres contract keeps seeding, the ordered sweep steps, and their assertions together so the real store behavior stays auditable in one place.
async function main() {
  await seed();
  await legalHoldsPause();

  const onEntry = await dueAt(day(1));
  check(
    "day 1: an account with no notice, or only one for an older deadline, is owed one",
    onEntry
      .map((account) => account.userId)
      .sort()
      .join() === [ids.fresh, ids.staleNotice, ids.terminated].sort().join(),
    onEntry,
  );
  const terminated = onEntry.find((account) => account.userId === ids.terminated);
  check(
    "a terminated account is read by its termination's deadline, as terminated",
    terminated?.kind === "terminated" &&
      terminated.retentionDeadline.getTime() === deadline.getTime(),
    terminated,
  );
  check(
    "a notice keyed to an older deadline reads as none sent",
    onEntry.find((account) => account.userId === ids.staleNotice)?.sentNotice === null,
  );

  const atDay60 = (await dueAt(day(60))).map((account) => account.userId);
  check("day 60: the account sent day 0 is owed its next notice", atDay60.includes(ids.notified));
  check("an admitted account is never listed", !atDay60.includes(ids.admitted));
  check("an account already being deleted is left to its intent", !atDay60.includes(ids.deleting));

  await store.recordNotice({
    userId: ids.notified,
    retentionDeadline: deadline,
    stage: "day_60",
    at: day(60),
  });
  const [recorded] = await getDb()
    .select()
    .from(deletionNotices)
    .where(eq(deletionNotices.userId, ids.notified));
  check("recording a notice replaces the last one sent", recorded?.stage === "day_60", recorded);
  check(
    "day 61: nothing more until day 83",
    !(await dueAt(day(61))).some((account) => account.userId === ids.notified),
  );

  await store.markAttempted({ userId: ids.fresh, retentionDeadline: deadline, at: day(1) });
  const afterAttempt = (await dueAt(day(1))).map((account) => account.userId);
  check(
    "an attempted account moves behind those never attempted",
    afterAttempt.at(-1) === ids.fresh,
    afterAttempt,
  );
  await store.markAttempted({ userId: ids.staleNotice, retentionDeadline: deadline, at: day(1) });
  const [restarted] = await getDb()
    .select()
    .from(deletionNotices)
    .where(eq(deletionNotices.userId, ids.staleNotice));
  check(
    "an attempt under a new deadline clears the old deadline's notice",
    restarted?.stage === null && restarted.retentionDeadline.getTime() === deadline.getTime(),
    restarted,
  );
  await store.markAttempted({ userId: ids.notified, retentionDeadline: deadline, at: day(61) });
  const [kept] = await getDb()
    .select()
    .from(deletionNotices)
    .where(eq(deletionNotices.userId, ids.notified));
  check("an attempt under the same deadline keeps its notice", kept?.stage === "day_60", kept);

  check(
    "no purge is claimed before the deadline",
    !(await store.claimPurge({ userId: ids.fresh, retentionDeadline: deadline, now: day(89) })),
  );
  await getDb()
    .update(accessProfiles)
    .set({ status: "granted", source: "paid_access", retentionDeadline: null })
    .where(eq(accessProfiles.userId, ids.staleNotice));
  check(
    "no purge is claimed for an account that resubscribed after it was listed",
    !(await store.claimPurge({
      userId: ids.staleNotice,
      retentionDeadline: deadline,
      now: day(90),
    })),
  );
  check(
    "a Lapsed account's later deadline never claims a terminated account's purge",
    !(await store.claimPurge({
      userId: ids.terminated,
      retentionDeadline: new Date(deadline.getTime() + 30 * DAY),
      now: day(200),
    })),
  );

  const journal = createInMemoryRecoveryJournal();
  const confirmed: string[] = [];
  const sent: string[] = [];
  const deletion = {
    store: createDrizzleAccountDeletionStore(),
    journal,
    revokeSessions: async () => {},
    cancelSubscriptions: async () => {},
    confirmPurge: async ({ to }: { to: string }) => {
      confirmed.push(to);
    },
  };
  const result = await runAccountRetentionSweep({
    store: {
      ...store,
      // Only this run's fixtures, whatever else the database holds.
      listDue: async (input) => dueAt(input.now),
    },
    sendNotice: async ({ userId, stage }) => {
      sent.push(`${userId}:${stage}`);
    },
    assertDeletionAllowed: async () => {},
    purge: ({ userId, now }) => requestAccountDeletion(deletion, { userId, now }),
    limit: 1000,
    now: day(90),
  });

  check("day 90: the sweep purges the accounts past their deadline", result.purged === 3, result);
  check("and sends no notice once the deadline has passed", sent.length === 0, sent);
  const remaining = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, [ids.fresh, ids.notified, ids.terminated]));
  check("their account rows are gone", remaining.length === 0, remaining);
  check("a Deletion Record was journaled for each", journal.pathnames().length === 3);
  check(
    "each purge was confirmed to the account's address",
    confirmed.sort().join() ===
      [ids.fresh, ids.notified, ids.terminated]
        .map((id) => `${id}@example.invalid`)
        .sort()
        .join(),
    confirmed,
  );
  const survivors = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(
      inArray(user.id, [
        ids.staleNotice,
        ids.admitted,
        ids.deleting,
        ids.held,
        ids.heldTerminated,
        ids.heldDeleting,
      ]),
    );
  check(
    "resubscribed, admitted, already-deleting, and held accounts are untouched",
    survivors.length === 6,
  );
}

try {
  await main();
} finally {
  await cleanup();
  await closeDb();
}
reportLiveCheckResult();
