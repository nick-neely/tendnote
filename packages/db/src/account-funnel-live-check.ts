/**
 * Live verification of the account funnel's eligibility, run by hand against
 * the disposable dev database.
 *
 * Not in the suite because every guarantee here is a clause Postgres enforces:
 * the append re-reads the opt-out and any pending deletion inside the insert,
 * the primary key collapses a redelivered stage, and the foreign keys erase an
 * account's events with it. A unit test could only assert the query was built.
 *
 *   pnpm --filter @tendnote/db db:account-funnel:check
 *
 * It makes its own throwaway accounts and deletes them on the way out.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import { check, reportLiveCheckResult } from "./live-check";
import {
  readAccountFunnelReport,
  recordRequestFunnelStage,
  recordServerFunnelStage,
  setTelemetryOptedOut,
  suppressRequestFunnelStage,
  sweepAccountFunnelEvents,
} from "./queries/account-telemetry";
import {
  accessProfiles,
  accountDeletionIntents,
  accountFunnelEvents,
  funnelAccounts,
  user,
} from "./schema";

const collecting = `funnel-live-${randomUUID()}`;
const optedOut = `funnel-live-${randomUUID()}`;
const deleting = `funnel-live-${randomUUID()}`;
const neverEnrolled = `funnel-live-${randomUUID()}`;
const accounts = [collecting, optedOut, deleting, neverEnrolled];

async function stagesOf(userId: string) {
  const rows = await getDb()
    .select({ stage: accountFunnelEvents.stage })
    .from(accountFunnelEvents)
    .innerJoin(funnelAccounts, eq(funnelAccounts.id, accountFunnelEvents.funnelAccountId))
    .where(eq(funnelAccounts.userId, userId));
  return rows.map((row) => row.stage).sort();
}

async function cleanup() {
  await getDb().delete(user).where(inArray(user.id, accounts));
}

// fallow-ignore-next-line complexity -- One uninterrupted narrative against a real Postgres: enrol, append, opt out, delete, expire. Its complexity is a run of independent assertions, and its CRAP score is the absence of the unit coverage this script exists to do without.
async function main() {
  const db = getDb();
  await cleanup();
  await db
    .insert(user)
    .values(accounts.map((id) => ({ id, name: "Funnel check", email: `${id}@example.test` })));
  await db.insert(accessProfiles).values(accounts.map((userId) => ({ userId })));

  try {
    console.log("\na known-US request enrols the account and records its stage:");
    await recordRequestFunnelStage({ userId: collecting, stage: "signup_completed" });
    check("signup is recorded", (await stagesOf(collecting)).join() === "signup_completed");
    const [enrolment] = await db
      .select({ id: funnelAccounts.id })
      .from(funnelAccounts)
      .where(eq(funnelAccounts.userId, collecting));
    check(
      "under an opaque id that is not the account id",
      enrolment !== undefined && enrolment.id !== collecting,
    );

    console.log("\nserver state records once per stage:");
    await recordServerFunnelStage({ userId: collecting, stage: "payment_confirmed" });
    await recordServerFunnelStage({ userId: collecting, stage: "payment_confirmed" });
    check(
      "a redelivered payment adds nothing",
      (await stagesOf(collecting)).join() === "payment_confirmed,signup_completed",
    );

    console.log("\na checkout from outside the US suppresses the stages it leads to:");
    await suppressRequestFunnelStage({ userId: collecting, stage: "checkout_started" });
    await recordServerFunnelStage({ userId: collecting, stage: "paid_access_granted" });
    check(
      "admission after a suppressed checkout is not recorded",
      !(await stagesOf(collecting)).includes("paid_access_granted"),
    );
    await recordRequestFunnelStage({ userId: collecting, stage: "checkout_started" });
    check(
      "a later known-US checkout makes the account eligible again",
      (await stagesOf(collecting)).includes("checkout_started"),
    );

    console.log("\nserver state alone never enrols an account:");
    await recordServerFunnelStage({ userId: neverEnrolled, stage: "paid_access_granted" });
    const [none] = await db
      .select({ id: funnelAccounts.id })
      .from(funnelAccounts)
      .where(eq(funnelAccounts.userId, neverEnrolled));
    check("no enrolment and no event", none === undefined);

    console.log("\nopting out is honoured at enrolment and at append:");
    await setTelemetryOptedOut({ userId: optedOut, optedOut: true });
    await recordRequestFunnelStage({ userId: optedOut, stage: "signup_completed" });
    check("an opted-out request records nothing", (await stagesOf(optedOut)).length === 0);
    await setTelemetryOptedOut({ userId: collecting, optedOut: true });
    await recordServerFunnelStage({ userId: collecting, stage: "paid_access_granted" });
    check(
      "an enrolled account that opts out records nothing more",
      !(await stagesOf(collecting)).includes("paid_access_granted"),
    );
    check(
      "and keeps what it had until expiry",
      (await stagesOf(collecting)).join() === "checkout_started,payment_confirmed,signup_completed",
    );
    await setTelemetryOptedOut({ userId: collecting, optedOut: false });
    await recordServerFunnelStage({ userId: collecting, stage: "first_person_created" });
    check(
      "opting back in records only what happens next",
      (await stagesOf(collecting)).join() ===
        "checkout_started,first_person_created,payment_confirmed,signup_completed",
    );

    console.log("\na requested deletion stops collection, and deletion erases it:");
    await recordRequestFunnelStage({ userId: deleting, stage: "checkout_started" });
    await db.insert(accountDeletionIntents).values({ userId: deleting });
    await recordServerFunnelStage({ userId: deleting, stage: "payment_confirmed" });
    check(
      "nothing is recorded once deletion is requested",
      (await stagesOf(deleting)).join() === "checkout_started",
    );
    await db.delete(user).where(eq(user.id, deleting));
    const [erased] = await db
      .select({ id: funnelAccounts.id })
      .from(funnelAccounts)
      .where(eq(funnelAccounts.userId, deleting));
    check("deleting the account erases its enrolment and events", erased === undefined);

    console.log("\nthe report counts the signup cohort:");
    const now = new Date();
    const report = await readAccountFunnelReport({
      since: new Date(now.getTime() - 60_000),
      until: new Date(now.getTime() + 60_000),
    });
    check(
      "this run's account appears once per stage",
      report.cohort.signup_completed >= 1 && report.cohort.payment_confirmed >= 1,
      report,
    );
    check("accounts created include this run's", report.accountsCreated >= 3, report);

    console.log("\nevents past retention are swept:");
    const later = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000);
    await sweepAccountFunnelEvents(later);
    check("nothing of this run survives ninety days", (await stagesOf(collecting)).length === 0);
  } finally {
    await cleanup();
  }

  reportLiveCheckResult();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
