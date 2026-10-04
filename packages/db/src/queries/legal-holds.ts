import { and, Column, eq, getTableName, gt, is, type SQL, sql } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../client";
import { legalHolds } from "../schema";

/** The Legal Hold Operator Action's record (#632). */
export type LegalHold = {
  id: string;
  userId: string;
  expiresAt: Date;
  placedAt: Date;
};

/**
 * Place a Legal Hold on the account's data until `expiresAt`, or return the
 * record a retry of the same hold already wrote.
 */
export async function recordLegalHold(input: {
  userId: string;
  expiresAt: Date;
  placedAt: Date;
}): Promise<LegalHold> {
  const db = getDb();
  await db.insert(legalHolds).values(input).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(legalHolds)
    .where(and(eq(legalHolds.userId, input.userId), eq(legalHolds.expiresAt, input.expiresAt)))
    .limit(1);
  if (!row) throw new Error("Failed to write the Legal Hold.");
  return row;
}

/** A column named by its table, which Drizzle leaves out inside a select list. */
function qualified(column: Column): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/**
 * Whether the account named by `userId` has a Legal Hold that expires after
 * `at`. At `now` that is a hold in force, since a hold is never placed in the
 * future. At an earlier moment it is a hold in force at any time since, which
 * is how the stuck-deletion alert counts from the end of a hold. Every column
 * is qualified, so it reads the same in a select list as in a filter.
 */
export function heldBeyond(userId: Column | SQL, at: Date): SQL {
  const account = is(userId, Column) ? qualified(userId) : userId;
  return sql`exists (
    select 1 from ${legalHolds}
    where ${qualified(legalHolds.userId)} = ${account}
      and ${qualified(legalHolds.expiresAt)} > ${at.toISOString()}::timestamptz
  )`;
}

/** Whether a Legal Hold is in force over the account's data at `now`. */
export async function isAccountHeld(
  input: { userId: string; now?: Date },
  db: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: legalHolds.id })
    .from(legalHolds)
    .where(
      and(eq(legalHolds.userId, input.userId), gt(legalHolds.expiresAt, input.now ?? new Date())),
    )
    .limit(1);
  return Boolean(row);
}
