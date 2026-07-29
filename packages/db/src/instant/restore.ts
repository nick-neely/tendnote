import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { generalActions } from "../schema";
import {
  FIXTURE_NOW,
  instantDatabaseUrl,
  isInstantMutationAction,
  PRIMARY_OWNER,
} from "./fixture-data";

/**
 * Put one of the fixture's private Actions back the way the seed left it.
 *
 * The Instant matrix seeds once per run and every mutation scenario is supposed
 * to return its own record to known state through the product's own Reopen
 * command — ADR 0210 requires exactly that. What neither the ADR nor the fixture
 * covered is the abnormal exit: a spec that breaches a budget mid-way aborts
 * *before* the half that restores, and the seeded world stays dirty for whatever
 * runs next. Both browser projects share one Postgres service for the job, so
 * that turned one real failure into two — `desktop-chromium` failing on its
 * reconciliation budget and `mobile-chromium` then failing with "element(s) not
 * found" for a row that was simply still completed (#331).
 *
 * So this is the teardown net, not the scenario: the measured path still runs
 * through the product, and this only guarantees the invariant the *next* test
 * depends on regardless of how the previous one exited. It writes directly
 * because after a failed test the page is exactly the thing that cannot be
 * trusted to drive a command.
 *
 * Deliberately scoped to a single Action rather than reseeding: the matrix is
 * fully parallel, and resetting the whole fixture would reach into a record
 * another live worker is mid-mutation on.
 */
export async function restoreInstantMutationAction(actionId: string): Promise<void> {
  const seeded = isInstantMutationAction(actionId);
  if (!seeded) {
    // Refusing rather than writing: the guard is what keeps a teardown from
    // becoming an arbitrary update against whatever `DATABASE_URL` points at.
    throw new Error(
      `Refusing to restore "${actionId}": it is not one of the Instant fixture's private mutation Actions.`,
    );
  }

  // `instantDatabaseUrl` refuses any database whose name is not recognisably the
  // rig's own, which is the same guard the seed relies on before it deletes.
  const client = postgres(instantDatabaseUrl(), { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    await db
      .update(generalActions)
      .set({
        status: seeded.status,
        completedAt: seeded.completedAt,
        dueAt: seeded.dueAt,
        updatedAt: FIXTURE_NOW,
      })
      .where(
        and(eq(generalActions.id, seeded.id), eq(generalActions.ownerUserId, PRIMARY_OWNER.userId)),
      );
  } finally {
    await client.end();
  }
}
