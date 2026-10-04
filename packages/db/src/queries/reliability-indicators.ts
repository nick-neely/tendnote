import {
  BACKGROUND_BACKLOG_LIMIT_MS,
  REMINDER_LATENESS_LIMIT_MS,
} from "@tendnote/domain/operator-alerts";
import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  actionExtractionJobs,
  contextFactExtractionJobs,
  extractionJobs,
  ownerDataExportJobs,
  relationshipContextEmbeddingJobs,
  reminderDeliveryJobs,
} from "../schema";

/**
 * How far back a reminder resolved late still counts. A little over one cron
 * interval, so a reminder delivered late between two passes is seen by the
 * next one, and the alert clears one pass after reminders are on time again.
 */
const LATE_REMINDER_LOOKBACK_MS = 15 * 60 * 1000;

/**
 * How long past its freshness a job nothing has picked up still counts. Only
 * the dispatcher marks a job stale, so with it down a waiting job would
 * otherwise drop out an hour after its alert time and send a false recovery. A
 * day bounds it, so an ancient orphan cannot hold the alert forever.
 */
const UNCLAIMED_REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether reminder delivery is late, the Reliability Indicator (#649) read on
 * each alert pass. A reminder is late when more than five minutes pass between
 * its alert time and its push being accepted. Lateness runs from when the
 * delivery job could first have run, so a reminder set for a time already past
 * is not late by construction. It counts while the job is still waiting, up to
 * a day past its freshness, and for one lookback after it was accepted late or
 * dropped as stale. Suppression for any other reason, and an endpoint the push
 * service rejected, are not lateness.
 */
export async function hasLateReminderDelivery(input: { now: Date }): Promise<boolean> {
  const jobs = reminderDeliveryJobs;
  const lateBefore = new Date(input.now.getTime() - REMINDER_LATENESS_LIMIT_MS);
  const lookbackStart = new Date(input.now.getTime() - LATE_REMINDER_LOOKBACK_MS);
  const graceStart = new Date(input.now.getTime() - UNCLAIMED_REMINDER_GRACE_MS);
  const dueAt = sql`greatest(${jobs.intendedAt}, ${jobs.createdAt})`;
  // A raw expression has no column to map a Date through, so it compares to a timestamp literal.
  const dueBy = sql`${dueAt} <= ${lateBefore.toISOString()}::timestamptz`;
  const [late] = await getDb()
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        dueBy,
        or(
          and(
            or(
              inArray(jobs.status, ["pending", "running"]),
              and(eq(jobs.status, "failed"), eq(jobs.outcome, "transient_failure")),
            ),
            gt(jobs.freshUntil, graceStart),
          ),
          and(
            eq(jobs.outcome, "accepted"),
            gt(jobs.acceptedAt, lookbackStart),
            sql`${jobs.acceptedAt} > ${dueAt} + make_interval(secs => ${REMINDER_LATENESS_LIMIT_MS / 1000})`,
          ),
          and(eq(jobs.outcome, "suppressed_stale"), gt(jobs.updatedAt, lookbackStart)),
        ),
      ),
    )
    .limit(1);
  return Boolean(late);
}

/**
 * Every Postgres-owned background job family. A job is unfinished while
 * `pending`, `running`, or `failed` awaiting its retry (Context Fact
 * extraction's terminal failure is `dead_lettered`, so it never counts).
 */
const BACKGROUND_JOB_TABLES = [
  extractionJobs,
  actionExtractionJobs,
  contextFactExtractionJobs,
  relationshipContextEmbeddingJobs,
  ownerDataExportJobs,
] as const;
const UNFINISHED_JOB_STATUSES = ["pending", "running", "failed"] as const;

/**
 * Whether any background job has waited more than thirty minutes past when it
 * was due, the backlog Reliability Indicator (#649). A job's `run_after` is
 * when it became due: enqueue time at first, the retry time after a failure,
 * and the reset time after an Account Ceiling or Spend Breaker deferral, so a
 * deliberately deferred job does not count until it is due again. Reminder
 * pushes are left to the reminder lateness indicator.
 */
export async function hasBackgroundBacklog(input: { now: Date }): Promise<boolean> {
  const dueBefore = new Date(input.now.getTime() - BACKGROUND_BACKLOG_LIMIT_MS);
  const db = getDb();
  const found = await Promise.all(
    BACKGROUND_JOB_TABLES.map(async (table) => {
      const [job] = await db
        .select({ id: table.id })
        .from(table)
        .where(
          and(inArray(table.status, [...UNFINISHED_JOB_STATUSES]), lte(table.runAfter, dueBefore)),
        )
        .limit(1);
      return Boolean(job);
    }),
  );
  return found.some(Boolean);
}
