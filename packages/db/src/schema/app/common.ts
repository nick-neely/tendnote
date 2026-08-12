import { sql } from "drizzle-orm";
import { type AnyPgColumn, timestamp } from "drizzle-orm/pg-core";

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Shared database invariant for member-owned and Household-native record roots. */
export function householdRecordOwnershipCheck(columns: {
  ownership: AnyPgColumn;
  ownerUserId: AnyPgColumn;
  householdId: AnyPgColumn;
  scope: AnyPgColumn;
}) {
  return sql`(
    (${columns.ownership} = 'member_owned' and ${columns.ownerUserId} is not null)
    or (
      ${columns.ownership} = 'household_native'
      and ${columns.householdId} is not null
      and ${columns.scope} = 'household'
    )
  )`;
}
