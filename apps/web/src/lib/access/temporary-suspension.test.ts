import type { AdmissionPolicy, RecoveryJournalRecord } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { resolveAccessState } from "./access-state";
import { createAdmissionHarness } from "./admission-harness";
import {
  liftSuspension,
  renewSuspensionReview,
  suspendAccount,
  type TemporarySuspensionDependencies,
} from "./temporary-suspension";
import { createTemporarySuspensionsFake } from "./temporary-suspensions-fake";
import { createTerminationsFake } from "./terminations-fake";

const user = { id: "subscriber-1", email: "subscriber@example.com" };
const sessionUser = { ...user, emailVerified: true, name: "Sam" };
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
/** A Saturday, so the review deadline has a weekend to skip. */
const SUSPENDED_AT = new Date("2026-10-03T12:00:00.000Z");
const LIFTED_AT = new Date("2026-10-09T09:30:00.000Z");

/**
 * The suspension actions over the web and Eve halves of one admission, an
 * in-memory Recovery Journal, and session revocation. `steps` records the
 * order the records, the journal, and the sessions were touched in.
 */
async function suspensionScenario() {
  const steps: string[] = [];
  const suspensions = createTemporarySuspensionsFake({ steps });
  const harness = createAdmissionHarness({
    policy: hosted,
    evaluateFlag: vi.fn().mockResolvedValue(false),
    user,
    listAdmissionBlocks: suspensions.listAdmissionBlocks,
  });
  const journaled: RecoveryJournalRecord[] = [];
  const journal = {
    write: vi.fn(async (record: RecoveryJournalRecord) => {
      journaled.push(record);
      steps.push(`journal:${record.kind}`);
    }),
  };
  const revokeSessions = vi.fn(async (_input: { userId: string }) => {
    steps.push("sessions:revoked");
  });
  const deps: TemporarySuspensionDependencies = {
    journal,
    suspensions: suspensions.records,
    terminations: createTerminationsFake().records,
    revokeSessions,
  };

  await harness.queries.grantAccess({
    userId: user.id,
    source: "paid_access",
    stripeSubscriptionId: "sub_1",
  });

  async function expectAdmitted(admitted: boolean) {
    await expect(
      harness.web.resolveAccess({ userId: user.id, email: user.email }),
    ).resolves.toMatchObject({ admitted });
    if (admitted) {
      await expect(harness.eve(eveRequest)).resolves.toMatchObject({ principalId: user.id });
    } else {
      await expect(harness.eve(eveRequest)).rejects.toBeInstanceOf(ForbiddenError);
    }
  }

  /** Where the web app sends this account, deciding suspension from the same records. */
  async function landing() {
    const state = await resolveAccessState(
      sessionUser,
      (entity) => harness.web.resolveAccess(entity),
      async () => [],
      async (userId) =>
        (await suspensions.records.findOpenSuspension({ userId }))
          ? { kind: "suspension" as const }
          : null,
    );
    return state.state;
  }

  return {
    ...harness,
    deps,
    steps,
    journaled,
    journal,
    revokeSessions,
    suspensions,
    expectAdmitted,
    landing,
  };
}

describe("Temporary Suspension (#629)", () => {
  it("denies admission on Web and Eve, with no exception, from the moment the record commits", async () => {
    const op = await suspensionScenario();
    await op.expectAdmitted(true);

    const result = await suspendAccount(op.deps, {
      userId: user.id,
      reason: "Reported abuse under review",
      now: SUSPENDED_AT,
    });

    await op.expectAdmitted(false);
    expect(await op.landing()).toBe("restricted");
    expect(result).toEqual({
      suspensionId: "suspension-1",
      suspendedAt: SUSPENDED_AT,
      // Ten business days, skipping both weekends, at the same UTC time.
      reviewDeadline: new Date("2026-10-16T12:00:00.000Z"),
      resumed: false,
    });
  });

  it("writes the record, then revokes every session, then journals it", async () => {
    const op = await suspensionScenario();

    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });

    expect(op.steps).toEqual(["record:suspension", "sessions:revoked", "journal:suspension"]);
    expect(op.journaled).toEqual([
      { kind: "suspension", accountId: user.id, actionId: "suspension-1", at: SUSPENDED_AT },
    ]);
    expect(op.revokeSessions).toHaveBeenCalledExactlyOnceWith({ userId: user.id });
  });

  it("leaves the Paid Access projection alone: Stripe's view of the account is unchanged", async () => {
    const op = await suspensionScenario();

    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });

    await expect(op.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      status: "granted",
      source: "paid_access",
    });
  });

  it("refuses a suspension without a reason, writing nothing", async () => {
    const op = await suspensionScenario();

    await expect(suspendAccount(op.deps, { userId: user.id, reason: "  " })).rejects.toThrow(
      "A suspension needs a reason.",
    );
    expect(op.steps).toEqual([]);
  });

  it("resumes an open suspension rather than opening a second one", async () => {
    const op = await suspensionScenario();
    op.journal.write.mockRejectedValueOnce(new Error("journal down"));

    await expect(
      suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT }),
    ).rejects.toThrow("journal down");
    await op.expectAdmitted(false);
    expect(op.revokeSessions).toHaveBeenCalledOnce();

    const resumed = await suspendAccount(op.deps, {
      userId: user.id,
      reason: "Review",
      now: LIFTED_AT,
    });

    expect(resumed).toMatchObject({ suspensionId: "suspension-1", resumed: true });
    expect(op.suspensions.suspensions).toHaveLength(1);
    // Same record, same time, so the same journal entry.
    expect(op.journaled).toEqual([
      { kind: "suspension", accountId: user.id, actionId: "suspension-1", at: SUSPENDED_AT },
    ]);
    expect(op.revokeSessions).toHaveBeenCalledTimes(2);
  });

  it("renews the review deadline as its own audited record, without changing admission", async () => {
    const op = await suspensionScenario();
    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });
    const renewedAt = new Date("2026-10-15T08:00:00.000Z");

    const renewal = await renewSuspensionReview(op.deps, { userId: user.id, now: renewedAt });

    expect(renewal).toEqual({
      suspensionId: "suspension-1",
      previousDeadline: new Date("2026-10-16T12:00:00.000Z"),
      reviewDeadline: new Date("2026-10-29T08:00:00.000Z"),
    });
    expect(op.suspensions.renewals).toEqual([
      { suspensionId: "suspension-1", reviewDeadline: renewal.reviewDeadline, renewedAt },
    ]);
    await expect(
      op.suspensions.records.findOpenSuspension({ userId: user.id }),
    ).resolves.toMatchObject({ reviewDeadline: renewal.reviewDeadline });
    await op.expectAdmitted(false);
  });

  it("refuses to renew when no suspension is open", async () => {
    const op = await suspensionScenario();

    await expect(renewSuspensionReview(op.deps, { userId: user.id })).rejects.toThrow(
      `Account ${user.id} has no open suspension.`,
    );
    expect(op.steps).toEqual([]);
  });

  it("lifts as an audited, journaled transition that restores admission", async () => {
    const op = await suspensionScenario();
    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });

    const lifted = await liftSuspension(op.deps, { userId: user.id, now: LIFTED_AT });

    expect(lifted).toEqual({
      suspensionId: "suspension-1",
      suspendedAt: SUSPENDED_AT,
      liftedAt: LIFTED_AT,
      resumed: false,
    });
    expect(op.steps.slice(-2)).toEqual(["record:lift", "journal:suspension-lift"]);
    expect(op.journaled.at(-1)).toEqual({
      kind: "suspension-lift",
      accountId: user.id,
      actionId: "suspension-1",
      at: LIFTED_AT,
    });
    await op.expectAdmitted(true);
    expect(await op.landing()).toBe("admitted");
  });

  it("resumes a lift whose journal write failed under the same entry", async () => {
    const op = await suspensionScenario();
    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });
    op.journal.write.mockRejectedValueOnce(new Error("journal down"));

    await expect(liftSuspension(op.deps, { userId: user.id, now: LIFTED_AT })).rejects.toThrow(
      "journal down",
    );
    const resumed = await liftSuspension(op.deps, { userId: user.id });

    expect(resumed).toEqual({
      suspensionId: "suspension-1",
      suspendedAt: SUSPENDED_AT,
      liftedAt: LIFTED_AT,
      resumed: true,
    });
    expect(op.journaled.at(-1)).toMatchObject({ kind: "suspension-lift", at: LIFTED_AT });
  });

  it("refuses to lift an account that was never suspended", async () => {
    const op = await suspensionScenario();

    await expect(liftSuspension(op.deps, { userId: user.id })).rejects.toThrow(
      `Account ${user.id} has no suspension to lift.`,
    );
    expect(op.journaled).toEqual([]);
  });

  it("holds alongside a lapse during the review, and the lift then lands the account in Lapsed", async () => {
    const op = await suspensionScenario();
    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });

    // The dunning window closes mid-review exactly as it would without one.
    await op.queries.lapsePaidAccess({
      userId: user.id,
      stripeSubscriptionId: "sub_1",
      lapsedAt: new Date("2026-10-08T00:00:00.000Z"),
    });
    expect(await op.landing()).toBe("restricted");

    await liftSuspension(op.deps, { userId: user.id, now: LIFTED_AT });

    await op.expectAdmitted(false);
    expect(await op.landing()).toBe("lapsed");
  });

  it("ends a suspended Owner's sponsorship of a Household Guest, keeping the membership, until the lift", async () => {
    const op = await suspensionScenario();
    const guest = { id: "guest-1", email: "guest@example.com" };
    op.households.set(guest.id, { householdId: "household-1", ownerUserIds: [user.id] });
    const guestView = () => op.web.resolveAccess({ userId: guest.id, email: guest.email });

    await expect(guestView()).resolves.toMatchObject({ guest: { householdId: "household-1" } });

    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });
    await expect(guestView()).resolves.not.toHaveProperty("guest");
    expect(op.households.get(guest.id)).toEqual({
      householdId: "household-1",
      ownerUserIds: [user.id],
    });

    await liftSuspension(op.deps, { userId: user.id, now: LIFTED_AT });
    await expect(guestView()).resolves.toMatchObject({ guest: { householdId: "household-1" } });
  });
});
