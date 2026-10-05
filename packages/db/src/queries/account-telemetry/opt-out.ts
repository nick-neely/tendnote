import { eq, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles, accountDeletionIntents } from "../../schema";

/*
 * The opt-out is stored on the Access Profile, the row every signed-up account
 * has, but it is a telemetry setting, not an admission fact, so it is read and
 * written here beside the collectors that honour it rather than through the
 * admission queries.
 */

/** Whether this account has switched optional telemetry off. */
export async function isTelemetryOptedOut(input: { userId: string }): Promise<boolean> {
  const [row] = await getDb()
    .select({ optedOut: accessProfiles.telemetryOptedOut })
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, input.userId))
    .limit(1);
  return row?.optedOut ?? false;
}

/**
 * Whether this account still allows error reports: it has not switched
 * optional telemetry off and has not asked to be deleted. Both are read in one
 * statement, so a reader never sees one half of a change. The error reporter
 * asks this at capture and again just before forwarding.
 */
export async function allowsErrorReports(input: { userId: string }): Promise<boolean> {
  const [row] = await getDb().execute<{ allowed: boolean }>(sql`
    select
      not exists (
        select 1 from ${accessProfiles}
        where ${accessProfiles.userId} = ${input.userId} and ${accessProfiles.telemetryOptedOut}
      )
      and not exists (
        select 1 from ${accountDeletionIntents}
        where ${accountDeletionIntents.userId} = ${input.userId}
      ) as allowed
  `);
  return row?.allowed === true;
}

/**
 * Switch this account's optional telemetry off or back on. Turning it back on
 * collects only what happens afterwards; nothing is backfilled. The profile
 * must exist, so the control cannot report success while writing nothing.
 */
export async function setTelemetryOptedOut(input: {
  userId: string;
  optedOut: boolean;
}): Promise<boolean> {
  const [row] = await getDb()
    .update(accessProfiles)
    .set({ telemetryOptedOut: input.optedOut, updatedAt: new Date() })
    .where(eq(accessProfiles.userId, input.userId))
    .returning({ optedOut: accessProfiles.telemetryOptedOut });
  if (!row) throw new Error("Failed to update the analytics setting.");
  return row.optedOut;
}
