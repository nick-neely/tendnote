import type { AdmissionPolicy, RecoveryJournalRecord } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createStripeSubscriptionsFake } from "../billing/stripe-subscriptions-fake";
import { projectSubscription } from "../billing/subscription-projection";
import { resolveAccessState } from "./access-state";
import { createAdmissionHarness } from "./admission-harness";
import { liftSuspension, renewSuspensionReview, suspendAccount } from "./temporary-suspension";
import { createTemporarySuspensionsFake } from "./temporary-suspensions-fake";
import { type TerminationDependencies, terminateAccount } from "./termination";
import { createTerminationsFake } from "./terminations-fake";

const user = { id: "subscriber-1", email: "subscriber@example.com" };
const sessionUser = { ...user, emailVerified: true, name: "Sam" };
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
const SUSPENDED_AT = new Date("2026-10-03T12:00:00.000Z");
const TERMINATED_AT = new Date("2026-10-09T09:30:00.000Z");
/** Ninety days after the termination, to the millisecond. */
const RETENTION_DEADLINE = new Date("2027-01-07T09:30:00.000Z");
const PERIOD_END = new Date("2026-11-01T09:30:00.000Z");

/**
 * Termination over the web and Eve halves of one admission, the suspension and
 * termination records, Stripe's subscriptions beside Tendnote's projection, an
 * in-memory Recovery Journal, and session revocation. `steps` records the
 * order the records, the sessions, the journal, and Stripe were touched in.
 */
async function terminationScenario() {
  const steps: string[] = [];
  const terminations = createTerminationsFake({ steps });
  const suspensions = createTemporarySuspensionsFake({
    steps,
    isConverted: (id) => terminations.terminations.some((each) => each.suspensionId === id),
  });
  const harness = createAdmissionHarness({
    policy: hosted,
    evaluateFlag: vi.fn().mockResolvedValue(false),
    user,
    listAdmissionBlocks: async (input) => [
      ...(await suspensions.listAdmissionBlocks(input)),
      ...(await terminations.listAdmissionBlocks(input)),
    ],
  });
  const stripe = createStripeSubscriptionsFake(harness.queries, {
    stripeCustomerId: "cus_subscriber",
    periodEnd: PERIOD_END,
    isTerminated: terminations.isTerminated,
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
  const stopRenewal = vi.fn(async (id: string) => {
    steps.push("stripe:stop-renewal");
    return stripe.stopRenewal(id);
  });
  let liveSubscription: string | null = "sub_1";
  const deps: TerminationDependencies = {
    journal,
    terminations: terminations.records,
    suspensions: suspensions.records,
    revokeSessions,
    findLiveSubscription: async () =>
      liveSubscription ? { stripeSubscriptionId: liveSubscription } : null,
    retrieveSubscription: stripe.retrieveSubscription,
    stopRenewal,
    cancelSubscription: stripe.cancelSubscription,
    subscriptions: stripe.subscriptions,
  };
  const suspensionDeps = {
    journal,
    suspensions: suspensions.records,
    terminations: terminations.records,
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

  /** Where the web app sends this account, reading the restriction as production does. */
  async function landing() {
    return resolveAccessState(
      sessionUser,
      (entity) => harness.web.resolveAccess(entity),
      async () => [],
      async (userId) => {
        const termination = await terminations.records.findTermination({ userId });
        if (termination) {
          return { kind: "termination", retentionDeadline: termination.retentionDeadline };
        }
        return (await suspensions.records.findOpenSuspension({ userId }))
          ? { kind: "suspension" }
          : null;
      },
    );
  }

  return {
    ...harness,
    deps,
    suspensionDeps,
    steps,
    journaled,
    journal,
    revokeSessions,
    stopRenewal,
    stripe,
    suspensions,
    terminations,
    noLiveSubscription: () => {
      liveSubscription = null;
    },
    expectAdmitted,
    landing,
  };
}

describe("Termination (#630)", () => {
  it("denies admission on Web and Eve, with no exception, and starts the ninety-day clock", async () => {
    const op = await terminationScenario();
    await op.expectAdmitted(true);

    const result = await terminateAccount(op.deps, {
      userId: user.id,
      reason: "Repeated abuse",
      now: TERMINATED_AT,
    });

    await op.expectAdmitted(false);
    await expect(op.landing()).resolves.toMatchObject({
      state: "restricted",
      restriction: { kind: "termination", retentionDeadline: RETENTION_DEADLINE },
    });
    expect(result).toEqual({
      terminationId: "termination-1",
      terminatedAt: TERMINATED_AT,
      retentionDeadline: RETENTION_DEADLINE,
      convertedSuspensionId: null,
      stripeSubscriptionId: "sub_1",
      resumed: false,
    });
  });

  it("writes the record, revokes sessions, and journals it before Stripe stops the renewal", async () => {
    const op = await terminationScenario();

    await terminateAccount(op.deps, { userId: user.id, reason: "Abuse", now: TERMINATED_AT });

    expect(op.steps).toEqual([
      "record:termination",
      "sessions:revoked",
      "journal:termination",
      "stripe:stop-renewal",
      "record:termination-subscription",
    ]);
    expect(op.journaled).toEqual([
      { kind: "termination", accountId: user.id, actionId: "termination-1", at: TERMINATED_AT },
    ]);
    expect(op.terminations.terminations[0]).toMatchObject({
      reason: "Abuse",
      stripeSubscriptionId: "sub_1",
    });
  });

  it("cancels the renewal without telling the customer they cancelled", async () => {
    const op = await terminationScenario();

    await terminateAccount(op.deps, { userId: user.id, reason: "Abuse", now: TERMINATED_AT });

    await expect(op.stripe.retrieveSubscription("sub_1")).resolves.toMatchObject({
      cancelAt: PERIOD_END,
      endedAt: null,
    });
    expect(op.stripe.recorded.get("sub_1")).toMatchObject({ cancelAt: PERIOD_END });
    // The webhook for the same change projects it again, and still says nothing.
    await projectSubscription(
      op.stripe.subscriptions,
      user.id,
      await op.stripe.retrieveSubscription("sub_1"),
    );
    expect(op.stripe.confirmCancellation).not.toHaveBeenCalled();
  });

  it("keeps the clock from the termination when the subscription later ends", async () => {
    const op = await terminationScenario();
    await terminateAccount(op.deps, { userId: user.id, reason: "Abuse", now: TERMINATED_AT });

    op.stripe.stripeChanges("sub_1", { endedAt: PERIOD_END });
    await projectSubscription(
      op.stripe.subscriptions,
      user.id,
      await op.stripe.retrieveSubscription("sub_1"),
    );

    await op.expectAdmitted(false);
    await expect(op.landing()).resolves.toMatchObject({
      state: "restricted",
      restriction: { kind: "termination", retentionDeadline: RETENTION_DEADLINE },
    });
  });

  it("leaves a renewal the customer already cancelled as it is", async () => {
    const op = await terminationScenario();
    op.stripe.stripeChanges("sub_1", { cancelAt: PERIOD_END });

    const result = await terminateAccount(op.deps, { userId: user.id, reason: "Abuse" });

    expect(op.stopRenewal).not.toHaveBeenCalled();
    expect(result.stripeSubscriptionId).toBe("sub_1");
  });

  it("ends a Past Due subscription at once, so its failed renewal is never retried", async () => {
    const op = await terminationScenario();
    op.stripe.stripeChanges("sub_1", {
      pastDue: { invoiceId: "in_renewal", since: new Date("2026-10-07T00:00:00.000Z") },
    });

    const result = await terminateAccount(op.deps, {
      userId: user.id,
      reason: "Abuse",
      now: TERMINATED_AT,
    });

    expect(op.stripe.cancelSubscription).toHaveBeenCalledExactlyOnceWith("sub_1");
    expect(op.stopRenewal).not.toHaveBeenCalled();
    expect(result.stripeSubscriptionId).toBe("sub_1");
    expect(op.terminations.terminations[0]).toMatchObject({ stripeSubscriptionId: "sub_1" });
    await expect(op.landing()).resolves.toMatchObject({
      restriction: { kind: "termination", retentionDeadline: RETENTION_DEADLINE },
    });
  });

  it("makes no Stripe call for an account with no live subscription", async () => {
    const op = await terminationScenario();
    op.noLiveSubscription();

    const result = await terminateAccount(op.deps, { userId: user.id, reason: "Abuse" });

    expect(result.stripeSubscriptionId).toBeNull();
    expect(op.stopRenewal).not.toHaveBeenCalled();
    expect(op.stripe.retrieveSubscription).not.toHaveBeenCalled();
    await op.expectAdmitted(false);
  });

  it("refuses a termination without a reason, writing nothing", async () => {
    const op = await terminationScenario();

    await expect(terminateAccount(op.deps, { userId: user.id, reason: " " })).rejects.toThrow(
      "A termination needs a reason.",
    );
    expect(op.steps).toEqual([]);
  });

  it("makes no Stripe call when the journal write fails, then resumes under the same record", async () => {
    const op = await terminationScenario();
    op.journal.write.mockRejectedValueOnce(new Error("journal down"));

    await expect(
      terminateAccount(op.deps, { userId: user.id, reason: "Abuse", now: TERMINATED_AT }),
    ).rejects.toThrow("journal down");
    await op.expectAdmitted(false);
    expect(op.revokeSessions).toHaveBeenCalledOnce();
    expect(op.stopRenewal).not.toHaveBeenCalled();

    const resumed = await terminateAccount(op.deps, {
      userId: user.id,
      reason: "Another reason",
      now: new Date("2026-10-10T00:00:00.000Z"),
    });

    expect(resumed).toMatchObject({
      terminationId: "termination-1",
      retentionDeadline: RETENTION_DEADLINE,
      stripeSubscriptionId: "sub_1",
      resumed: true,
    });
    expect(op.terminations.terminations).toHaveLength(1);
    expect(op.terminations.terminations[0]).toMatchObject({ reason: "Abuse" });
    expect(op.journaled).toEqual([
      { kind: "termination", accountId: user.id, actionId: "termination-1", at: TERMINATED_AT },
    ]);
    expect(op.stopRenewal).toHaveBeenCalledOnce();
  });

  it("converts an open suspension, which can then be neither renewed nor lifted", async () => {
    const op = await terminationScenario();
    await suspendAccount(op.suspensionDeps, {
      userId: user.id,
      reason: "Review",
      now: SUSPENDED_AT,
    });

    const result = await terminateAccount(op.deps, {
      userId: user.id,
      reason: "Review upheld",
      now: TERMINATED_AT,
    });

    expect(result.convertedSuspensionId).toBe("suspension-1");
    const refusal = `Account ${user.id} is terminated; a termination is permanent.`;
    await expect(renewSuspensionReview(op.suspensionDeps, { userId: user.id })).rejects.toThrow(
      refusal,
    );
    await expect(liftSuspension(op.suspensionDeps, { userId: user.id })).rejects.toThrow(refusal);
    await expect(
      suspendAccount(op.suspensionDeps, { userId: user.id, reason: "Again" }),
    ).rejects.toThrow(refusal);
    // Converted, not lifted: the termination is the suspension's end.
    expect(op.suspensions.suspensions[0]?.liftedAt).toBeNull();
    await expect(
      op.suspensions.records.findOpenSuspension({ userId: user.id }),
    ).resolves.toBeNull();
    await op.expectAdmitted(false);
    await expect(op.landing()).resolves.toMatchObject({
      restriction: { kind: "termination" },
    });
  });

  it("ends a terminated Owner's sponsorship of a Household Guest, keeping the membership", async () => {
    const op = await terminationScenario();
    const guest = { id: "guest-1", email: "guest@example.com" };
    op.households.set(guest.id, { householdId: "household-1", ownerUserIds: [user.id] });
    const guestView = () => op.web.resolveAccess({ userId: guest.id, email: guest.email });

    await expect(guestView()).resolves.toMatchObject({ guest: { householdId: "household-1" } });

    await terminateAccount(op.deps, { userId: user.id, reason: "Abuse", now: TERMINATED_AT });

    await expect(guestView()).resolves.not.toHaveProperty("guest");
    expect(op.households.get(guest.id)).toEqual({
      householdId: "household-1",
      ownerUserIds: [user.id],
    });
  });
});
