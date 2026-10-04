import { deletionNoticeDueForDeadlinesBy } from "@tendnote/domain";
import {
  and,
  asc,
  type Column,
  eq,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import {
  accessProfiles,
  accountDeletionIntents,
  deletionNotices,
  terminations,
  user,
} from "../../schema";
import { heldBeyond } from "../legal-holds";
import type { AccountRetentionStore, RetentionAccount } from "./types";

type DueRow = RetentionAccount & { attemptedAt: Date | null };

/**
 * Whether an account whose deadline is `deadline`, and whose last notice for
 * it is the joined `deletion_notices` row, has anything due at `now`: no
 * notice yet, the next notice's time reached, or the deadline itself passed.
 */
function somethingDue(deadline: Column, now: Date): SQL | undefined {
  return or(
    isNull(deletionNotices.stage),
    and(
      eq(deletionNotices.stage, "day_0"),
      lte(deadline, deletionNoticeDueForDeadlinesBy("day_60", now)),
    ),
    and(
      eq(deletionNotices.stage, "day_60"),
      lte(deadline, deletionNoticeDueForDeadlinesBy("day_83", now)),
    ),
    lte(deadline, now),
  );
}

/**
 * Never-attempted first, then least recently attempted, earliest deadline
 * breaking ties: an account the household guard refuses, or whose notice keeps
 * failing, moves behind the rest instead of holding every pass's budget.
 */
function dueOrder(deadline: Column): SQL[] {
  return [sql`${deletionNotices.attemptedAt} asc nulls first`, asc(deadline)];
}

/** The never-attempted-first order of {@link dueOrder}, for merging the two lists. */
function attemptedTime(account: { attemptedAt: Date | null }): number {
  return account.attemptedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

export function createDrizzleAccountRetentionStore(
  resolveDb: () => DatabaseExecutor = getDb,
): AccountRetentionStore {
  async function listLapsed(now: Date, limit: number): Promise<DueRow[]> {
    const rows = await resolveDb()
      .select({
        userId: accessProfiles.userId,
        email: user.email,
        retentionDeadline: accessProfiles.retentionDeadline,
        sentNotice: deletionNotices.stage,
        attemptedAt: deletionNotices.attemptedAt,
      })
      .from(accessProfiles)
      .innerJoin(user, eq(user.id, accessProfiles.userId))
      .leftJoin(
        deletionNotices,
        and(
          eq(deletionNotices.userId, accessProfiles.userId),
          eq(deletionNotices.retentionDeadline, accessProfiles.retentionDeadline),
        ),
      )
      .leftJoin(terminations, eq(terminations.userId, accessProfiles.userId))
      .leftJoin(accountDeletionIntents, eq(accountDeletionIntents.userId, accessProfiles.userId))
      .where(
        and(
          ne(accessProfiles.status, "granted"),
          isNotNull(accessProfiles.retentionDeadline),
          // A terminated account's own deadline governs it; the later one its
          // subscription's end writes here is never acted on.
          isNull(terminations.id),
          isNull(accountDeletionIntents.userId),
          not(heldBeyond(accessProfiles.userId, now)),
          somethingDue(accessProfiles.retentionDeadline, now),
        ),
      )
      .orderBy(...dueOrder(accessProfiles.retentionDeadline), asc(accessProfiles.userId))
      .limit(limit);
    return rows.flatMap((row) =>
      row.retentionDeadline
        ? [{ ...row, kind: "lapsed" as const, retentionDeadline: row.retentionDeadline }]
        : [],
    );
  }

  async function listTerminated(now: Date, limit: number): Promise<DueRow[]> {
    const rows = await resolveDb()
      .select({
        userId: terminations.userId,
        email: user.email,
        retentionDeadline: terminations.retentionDeadline,
        sentNotice: deletionNotices.stage,
        attemptedAt: deletionNotices.attemptedAt,
      })
      .from(terminations)
      .innerJoin(user, eq(user.id, terminations.userId))
      .leftJoin(
        deletionNotices,
        and(
          eq(deletionNotices.userId, terminations.userId),
          eq(deletionNotices.retentionDeadline, terminations.retentionDeadline),
        ),
      )
      .leftJoin(accountDeletionIntents, eq(accountDeletionIntents.userId, terminations.userId))
      .where(
        and(
          isNull(accountDeletionIntents.userId),
          not(heldBeyond(terminations.userId, now)),
          somethingDue(terminations.retentionDeadline, now),
        ),
      )
      .orderBy(...dueOrder(terminations.retentionDeadline), asc(terminations.userId))
      .limit(limit);
    return rows.map((row) => ({ ...row, kind: "terminated" as const }));
  }

  return {
    async listDue({ now, limit }) {
      const [lapsed, terminated] = await Promise.all([
        listLapsed(now, limit),
        listTerminated(now, limit),
      ]);
      return [...lapsed, ...terminated]
        .sort(
          (a, b) =>
            attemptedTime(a) - attemptedTime(b) ||
            a.retentionDeadline.getTime() - b.retentionDeadline.getTime(),
        )
        .slice(0, limit)
        .map(({ attemptedAt: _attemptedAt, ...account }) => account);
    },

    async markAttempted({ userId, retentionDeadline, at }) {
      // A row left from an earlier deadline starts over: no notice sent yet.
      await resolveDb()
        .insert(deletionNotices)
        .values({ userId, retentionDeadline, attemptedAt: at })
        .onConflictDoUpdate({
          target: deletionNotices.userId,
          set: {
            retentionDeadline,
            attemptedAt: at,
            stage: sql`case when ${deletionNotices.retentionDeadline} = excluded.retention_deadline then ${deletionNotices.stage} end`,
            sentAt: sql`case when ${deletionNotices.retentionDeadline} = excluded.retention_deadline then ${deletionNotices.sentAt} end`,
          },
        });
    },

    async recordNotice({ userId, retentionDeadline, stage, at }) {
      await resolveDb()
        .insert(deletionNotices)
        .values({ userId, retentionDeadline, stage, sentAt: at })
        .onConflictDoUpdate({
          target: deletionNotices.userId,
          set: { retentionDeadline, stage, sentAt: at },
        });
    },

    async claimPurge({ userId, retentionDeadline, now }) {
      // One statement, so a grant that clears the deadline, or a Legal Hold
      // placed, after the sweep listed the account leaves this insert matching
      // nothing.
      const deadline = sql`${retentionDeadline.toISOString()}::timestamptz`;
      const at = sql`${now.toISOString()}::timestamptz`;
      const rows = await resolveDb().execute<{ user_id: string }>(sql`
        insert into ${accountDeletionIntents} (user_id, requested_at, reason)
        select ${userId}, ${at}, 'retention_deadline'
        where ${deadline} <= ${at}
          and not ${heldBeyond(sql`${userId}`, now)}
          and (
            exists (
              select 1 from ${terminations}
              where ${terminations.userId} = ${userId}
                and ${terminations.retentionDeadline} = ${deadline}
            )
            or exists (
              select 1 from ${accessProfiles}
              where ${accessProfiles.userId} = ${userId}
                and ${accessProfiles.status} <> 'granted'
                and ${accessProfiles.retentionDeadline} = ${deadline}
                and not exists (
                  select 1 from ${terminations} where ${terminations.userId} = ${userId}
                )
            )
          )
        on conflict do nothing
        returning user_id
      `);
      return rows.length > 0;
    },
  };
}
