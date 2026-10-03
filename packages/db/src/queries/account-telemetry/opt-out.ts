import { eq } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles } from "../../schema";

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
