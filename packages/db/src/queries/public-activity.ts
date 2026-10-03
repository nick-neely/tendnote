import {
  type PublicActivity,
  type PublicActivityTotals,
  publicActivityCutoffDay,
  publicActivityDay,
  publicActivityTotals,
} from "@tendnote/domain/public-activity";
import { and, gte, lt, lte, sql, sum } from "drizzle-orm";
import { getDb } from "../client";
import { publicActivityDailyCounts } from "../schema";
import { queryErrorCode } from "./query-error-code";

/**
 * Add one to the day's total for a public event on a public page. The caller
 * has already established the request is hosted and known US; nothing about
 * the request itself is stored. A failure is logged and swallowed, because a
 * counter must never fail the page it observes.
 */
export async function recordPublicActivity(input: PublicActivity & { at?: Date }) {
  try {
    await getDb()
      .insert(publicActivityDailyCounts)
      .values({
        day: publicActivityDay(input.at ?? new Date()),
        event: input.event,
        page: input.page,
      })
      .onConflictDoUpdate({
        target: [
          publicActivityDailyCounts.day,
          publicActivityDailyCounts.event,
          publicActivityDailyCounts.page,
        ],
        set: { count: sql`${publicActivityDailyCounts.count} + 1` },
      });
  } catch (error) {
    console.warn("public-activity: could not count an event", {
      event: input.event,
      reason: queryErrorCode(error),
    });
  }
}

/** Delete the daily totals older than their retention constant. */
export async function sweepPublicActivityCounts(now = new Date()) {
  const deleted = await getDb()
    .delete(publicActivityDailyCounts)
    .where(lt(publicActivityDailyCounts.day, publicActivityCutoffDay(now)))
    .returning({ day: publicActivityDailyCounts.day });

  return { deleted: deleted.length };
}

/** The public totals for the UTC days a report window touches. */
export async function readPublicActivityTotals(input: {
  since: Date;
  until: Date;
}): Promise<PublicActivityTotals> {
  const rows = await getDb()
    .select({
      event: publicActivityDailyCounts.event,
      page: publicActivityDailyCounts.page,
      count: sum(publicActivityDailyCounts.count).mapWith(Number),
    })
    .from(publicActivityDailyCounts)
    .where(
      and(
        gte(publicActivityDailyCounts.day, publicActivityDay(input.since)),
        lte(publicActivityDailyCounts.day, publicActivityDay(input.until)),
      ),
    )
    .groupBy(publicActivityDailyCounts.event, publicActivityDailyCounts.page);

  return publicActivityTotals(rows);
}
