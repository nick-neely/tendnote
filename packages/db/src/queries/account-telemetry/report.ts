import { type AccountFunnelReportData, accountFunnelCohort } from "@tendnote/domain/account-funnel";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles, accountFunnelEvents, user } from "../../schema";

/** A `count()` query's one row, read without assuming the row came back. */
function sumAccounts(rows: { accounts: number }[]): number {
  return rows.reduce((total, row) => total + row.accounts, 0);
}

/** What the saved operator report reads for the accounts that signed up in a window. */
export async function readAccountFunnelReport(input: {
  since: Date;
  until: Date;
}): Promise<AccountFunnelReportData> {
  const db = getDb();
  const signedUp = db
    .select({ id: accountFunnelEvents.funnelAccountId })
    .from(accountFunnelEvents)
    .where(
      and(
        eq(accountFunnelEvents.stage, "signup_completed"),
        gte(accountFunnelEvents.occurredAt, input.since),
        lt(accountFunnelEvents.occurredAt, input.until),
      ),
    );

  const [stageRows, created, optedOut] = await Promise.all([
    db
      .select({ stage: accountFunnelEvents.stage, accounts: count() })
      .from(accountFunnelEvents)
      .where(inArray(accountFunnelEvents.funnelAccountId, signedUp))
      .groupBy(accountFunnelEvents.stage),
    db
      .select({ accounts: count() })
      .from(user)
      .where(and(gte(user.createdAt, input.since), lt(user.createdAt, input.until))),
    db
      .select({ accounts: count() })
      .from(accessProfiles)
      .where(eq(accessProfiles.telemetryOptedOut, true)),
  ]);

  return {
    since: input.since,
    until: input.until,
    cohort: accountFunnelCohort(stageRows),
    accountsCreated: sumAccounts(created),
    accountsOptedOut: sumAccounts(optedOut),
  };
}
