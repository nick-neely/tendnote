/**
 * Live verification of the owner data export's Postgres store, run by hand
 * against the disposable dev database.
 *
 * Not a unit test and deliberately not in the suite: the processor's tests use
 * the in-memory store, so whether the Drizzle store's statements bind on the
 * real driver is the one thing they cannot answer. That gap hid a bug where
 * every export failed to write or read its artifact, because postgres-js
 * cannot bind a raw `Date` inside a `sql` template (#607). This also checks
 * that the artifact read stays owner-scoped and expiry-bound, and that
 * `ownerHasExportableData` sees an owner's records.
 *
 *   pnpm --filter @tendnote/db db:owner-data-export:check
 *
 * It seeds under the two demo accounts `pnpm db:seed` creates, and removes the
 * rows it made on the way out.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import {
  check,
  DEMO_INTRUDER,
  DEMO_OWNER,
  reportLiveCheckResult,
  requireDemoAccounts,
} from "./live-check";
import {
  createDrizzleOwnerDataExportArtifactStore,
  createDrizzleOwnerDataExportJobStore,
  ownerHasExportableData,
} from "./queries/owner-data-export";
import { ownerDataExportJobs, people } from "./schema";

// fallow-ignore-next-line complexity -- Same reason as the sibling live checks: a run of independent assertions against a real Postgres.
async function main() {
  await requireDemoAccounts();

  const jobs = createDrizzleOwnerDataExportJobStore();
  const artifacts = createDrizzleOwnerDataExportArtifactStore();
  const { job } = await jobs.enqueue({
    ownerUserId: DEMO_OWNER,
    idempotencyKey: `live-check:${randomUUID()}`,
  });
  const personId = randomUUID();

  try {
    const claimed = await jobs.claim({ jobId: job.id });
    check("the job is claimed with a token", Boolean(claimed?.claimToken), claimed);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    const bytes = new Uint8Array([80, 75, 3, 4]);

    console.log("\nthe artifact write binds its dates on the real driver:");
    const written = await artifacts.put({
      jobId: job.id,
      ownerUserId: DEMO_OWNER,
      expectedClaimToken: claimed?.claimToken ?? "",
      bytes,
      expiresAt,
    });
    check("the claimed job's artifact is written", written !== null, written);

    console.log("\nthe artifact read is owner-scoped and expiry-bound:");
    const read = await artifacts.get({ jobId: job.id, ownerUserId: DEMO_OWNER, now });
    check(
      "the owner reads the bytes back",
      read !== null && Buffer.from(read.bytes).equals(Buffer.from(bytes)),
      read,
    );
    check(
      "another account reads nothing",
      (await artifacts.get({ jobId: job.id, ownerUserId: DEMO_INTRUDER, now })) === null,
    );
    check(
      "nobody reads it once it has expired",
      (await artifacts.get({
        jobId: job.id,
        ownerUserId: DEMO_OWNER,
        now: new Date(expiresAt.getTime() + 1),
      })) === null,
    );

    console.log("\nownerHasExportableData sees an owner's records:");
    check(
      "an account with no records has nothing to export",
      !(await ownerHasExportableData(`live-check-${randomUUID()}`)),
    );
    await getDb()
      .insert(people)
      .values({ id: personId, ownerUserId: DEMO_OWNER, displayName: "Live check person" });
    check(
      "an account with a person has something to export",
      await ownerHasExportableData(DEMO_OWNER),
    );
  } finally {
    await getDb().delete(people).where(eq(people.id, personId));
    // The artifact cascades with its job.
    await getDb().delete(ownerDataExportJobs).where(eq(ownerDataExportJobs.id, job.id));
  }

  reportLiveCheckResult();
}

void main();
