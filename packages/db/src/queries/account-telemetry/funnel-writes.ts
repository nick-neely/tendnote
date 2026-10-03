import type {
  AccountFunnelStage,
  RequestFunnelStage,
  ServerFunnelStage,
} from "@tendnote/domain/account-funnel";
import { accountFunnelEventCutoff } from "@tendnote/domain/account-funnel";
import { eq, lt, sql } from "drizzle-orm";
import { getDb, withIsolatedSideWrite } from "../../client";
import {
  accessProfiles,
  accountDeletionIntents,
  accountFunnelEvents,
  funnelAccounts,
  user,
} from "../../schema";
import { queryErrorCode } from "../query-error-code";

/**
 * Eligibility is checked twice. The caller checks the request's region before
 * capture; then the statement that stores an event re-reads the opt-out and
 * any pending deletion in the same write, so nothing stale between the two can
 * record an event for an account that has opted out or asked to be deleted.
 * There is no queue: capture and forwarding meet in that one statement.
 *
 * Every write commits or fails on its own and a failure is logged and
 * swallowed, so telemetry can never fail the action it observes.
 */

/**
 * The clause both writes share, read inside the insert and never before: the
 * account has not switched telemetry off and has not asked to be deleted.
 */
const accountStillCollecting = sql`not exists (
    select 1 from ${accessProfiles}
    where ${accessProfiles.userId} = candidate.user_id and ${accessProfiles.telemetryOptedOut}
  )
  and not exists (
    select 1 from ${accountDeletionIntents}
    where ${accountDeletionIntents.userId} = candidate.user_id
  )`;

/** Enrol the account, or mark an existing enrolment eligible again. */
async function enrollFromUsRequest(userId: string): Promise<void> {
  await getDb().execute(sql`
    insert into ${funnelAccounts} (user_id, region_eligible)
    select candidate.user_id, true
    from (select ${user.id} as user_id from ${user} where ${user.id} = ${userId}) candidate
    where ${accountStillCollecting}
    on conflict (user_id) do update set region_eligible = true
  `);
}

async function appendStage(userId: string, stage: AccountFunnelStage, at: Date): Promise<void> {
  await getDb().execute(sql`
    insert into ${accountFunnelEvents} (funnel_account_id, stage, occurred_at)
    select candidate.id, ${stage}::account_funnel_stage, ${at.toISOString()}::timestamptz
    from (
      select ${funnelAccounts.id} as id, ${funnelAccounts.userId} as user_id
      from ${funnelAccounts}
      where ${funnelAccounts.userId} = ${userId} and ${funnelAccounts.regionEligible}
    ) candidate
    where ${accountStillCollecting}
    on conflict do nothing
  `);
}

async function writeQuietly(stage: AccountFunnelStage, write: () => Promise<void>) {
  try {
    // Inside an owner's transaction the write runs in a savepoint, so a failed
    // insert rolls back alone instead of aborting the owner's write.
    await withIsolatedSideWrite(write);
  } catch (error) {
    console.warn("account-funnel: could not record a stage", {
      stage,
      reason: queryErrorCode(error),
    });
  }
}

/**
 * Record a stage the account's own request started. The caller has already
 * established that the request's region is known US in hosted mode; that is
 * what enrols the account, unless it has opted out or asked to be deleted.
 */
export async function recordRequestFunnelStage(input: {
  userId: string;
  stage: RequestFunnelStage;
  at?: Date;
}) {
  await writeQuietly(input.stage, async () => {
    await enrollFromUsRequest(input.userId);
    await appendStage(input.userId, input.stage, input.at ?? new Date());
  });
}

/**
 * A signup or checkout request whose region is not known to be US. It records
 * nothing, and it suspends an existing enrolment, so the server-state stages
 * that follow this user action are suppressed too. A later known-US signup or
 * checkout makes the account eligible again.
 */
export async function suppressRequestFunnelStage(input: {
  userId: string;
  stage: RequestFunnelStage;
}) {
  await writeQuietly(input.stage, async () => {
    await getDb()
      .update(funnelAccounts)
      .set({ regionEligible: false })
      .where(eq(funnelAccounts.userId, input.userId));
  });
}

/**
 * Record a stage confirmed by Tendnote's own server state: payment, admission,
 * or an Activation Milestone. Only an enrolled, region-eligible account
 * records one: its eligibility comes from the account's most recent signup or
 * checkout request, never from where a webhook or Tendnote's server happens to
 * be. Each stage is recorded once, so a redelivery is a no-op, and only as it
 * happens, so an account that opted out is never backfilled when it opts back
 * in.
 */
export async function recordServerFunnelStage(input: {
  userId: string;
  stage: ServerFunnelStage;
  at?: Date;
}) {
  await writeQuietly(input.stage, () =>
    appendStage(input.userId, input.stage, input.at ?? new Date()),
  );
}

/** Delete the funnel events older than their retention constant. */
export async function sweepAccountFunnelEvents(now = new Date()) {
  const deleted = await getDb()
    .delete(accountFunnelEvents)
    .where(lt(accountFunnelEvents.occurredAt, accountFunnelEventCutoff(now)))
    .returning({ stage: accountFunnelEvents.stage });

  return { deleted: deleted.length };
}
