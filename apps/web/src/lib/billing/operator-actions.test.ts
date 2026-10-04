import {
  type AdmissionPolicy,
  lapsedRetentionDeadline,
  type RecoveryJournalRecord,
} from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { createTemporarySuspensionsFake } from "../access/temporary-suspensions-fake";
import { createTerminationsFake } from "../access/terminations-fake";
import {
  OPERATOR_USAGE,
  type OperatorActionDependencies,
  readmitAfterWonDispute,
  refundableInvoice,
  refundInvoice,
  runOperatorCommand,
} from "./operator-actions";
import {
  applyStripeDispute,
  applyStripeRefund,
  type RefundSnapshot,
} from "./paid-access-revocation";
import { createPaidAccessRevocationsFake } from "./paid-access-revocations-fake";
import { createStripeSubscriptionsFake } from "./stripe-subscriptions-fake";

const user = { id: "subscriber-1", email: "subscriber@example.com" };
const CUSTOMER = "cus_subscriber";
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
/** Mid-second, as a record's own clock is: Stripe states the refund in whole seconds. */
const NOW = new Date("2026-10-03T12:00:00.250Z");
const NOW_IN_STRIPE = new Date("2026-10-03T12:00:00.000Z");
const DISPUTED_AT = new Date("2026-10-02T08:00:00.000Z");

/**
 * The Operator Actions over the web and Eve halves of admission, one Access
 * Profile store, Stripe's subscriptions, and an in-memory Recovery Journal.
 * `steps` records the order records, the journal, and Stripe were touched in.
 */
async function operator() {
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
  const stripeSubscriptions = createStripeSubscriptionsFake(harness.queries, {
    stripeCustomerId: CUSTOMER,
    now: () => NOW,
    isTerminated: terminations.isTerminated,
  });
  const revocations = createPaidAccessRevocationsFake({ steps });
  const journaled: RecoveryJournalRecord[] = [];
  const journal = {
    write: vi.fn(async (record: RecoveryJournalRecord) => {
      journaled.push(record);
      steps.push(`journal:${record.kind}`);
    }),
  };
  const disputeStatuses = new Map<string, string>();
  const refundsByKey = new Map<string, RefundSnapshot>();
  let refundStatus = "succeeded";

  const deps: OperatorActionDependencies = {
    revocations: revocations.revocations,
    records: revocations.records,
    journal,
    subscriptions: stripeSubscriptions.subscriptions,
    retrieveSubscription: stripeSubscriptions.retrieveSubscription,
    cancelSubscription: stripeSubscriptions.cancelSubscription,
    stopRenewal: stripeSubscriptions.stopRenewal,
    resumeRenewal: vi.fn(async (id: string) => {
      steps.push("stripe:resume");
      return stripeSubscriptions.resumeRenewal(id);
    }),
    findAccountByStripeCustomer: async (id) => (id === CUSTOMER ? user.id : null),
    resolvePaymentSubscription: async (paymentIntentId) =>
      paymentIntentId === "pi_first"
        ? { stripeSubscriptionId: "sub_1", stripeCustomerId: CUSTOMER }
        : null,
    confirmRefund: vi.fn(async () => {}),
    retrieveRefundableInvoice: async (invoiceId) => ({
      invoiceId,
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: "sub_1",
      paymentIntentId: "pi_first",
      amountPaid: 2000,
    }),
    // Stripe's idempotency: one key, one refund, however often it is asked.
    createRefund: vi.fn(async ({ amount, idempotencyKey }) => {
      steps.push("stripe:refund");
      const refund = refundsByKey.get(idempotencyKey) ?? {
        id: `re_${refundsByKey.size + 1}`,
        paymentIntentId: "pi_first",
        amount,
        createdAt: NOW_IN_STRIPE,
        status: refundStatus,
      };
      refundsByKey.set(idempotencyKey, refund);
      return refund;
    }),
    retrieveDisputeStatus: async (id) => disputeStatuses.get(id) ?? "needs_response",
    suspensions: suspensions.records,
    terminations: terminations.records,
    findLiveSubscription: async ({ userId }) =>
      userId === user.id ? { stripeSubscriptionId: "sub_1" } : null,
    revokeSessions: vi.fn(async () => {
      steps.push("sessions:revoked");
    }),
    readAccessProfile: (userId) => harness.queries.getAccessProfile({ userId }),
    grantPaidAccess: (userId, stripeSubscriptionId) =>
      harness.queries.grantAccess({ userId, source: "paid_access", stripeSubscriptionId }),
  };

  await harness.queries.grantAccess({
    userId: user.id,
    source: "paid_access",
    stripeSubscriptionId: "sub_1",
  });

  async function expectAdmitted() {
    await expect(
      harness.web.resolveAccess({ userId: user.id, email: user.email }),
    ).resolves.toMatchObject({ admitted: true });
    await expect(harness.eve(eveRequest)).resolves.toMatchObject({ principalId: user.id });
  }

  async function expectNotAdmitted() {
    await expect(
      harness.web.resolveAccess({ userId: user.id, email: user.email }),
    ).resolves.toMatchObject({ admitted: false });
    await expect(harness.eve(eveRequest)).rejects.toBeInstanceOf(ForbiddenError);
  }

  /** A dispute arriving from Stripe, applied as the webhook applies it. */
  async function disputed(id: string, status = "needs_response") {
    disputeStatuses.set(id, status);
    await applyStripeDispute(deps, { id, paymentIntentId: "pi_first", openedAt: DISPUTED_AT });
  }

  return {
    ...harness,
    deps,
    steps,
    journaled,
    journal,
    revocations,
    suspensions,
    terminations,
    stripeSubscriptions,
    disputeStatuses,
    disputed,
    refundFails: () => {
      refundStatus = "failed";
    },
    expectAdmitted,
    expectNotAdmitted,
  };
}

describe("the Refund Operator Action (#617, ADR 0249)", () => {
  it("writes and journals its record before the Stripe call, then revokes and confirms", async () => {
    const op = await operator();

    const result = await refundInvoice(op.deps, { invoiceId: "in_first", now: NOW });

    expect(op.steps).toEqual(["record:refund", "journal:refund", "stripe:refund"]);
    expect(op.journaled).toEqual([
      { kind: "refund", accountId: user.id, actionId: result.refundRecordId, at: NOW },
    ]);
    expect(op.deps.createRefund).toHaveBeenCalledWith({
      paymentIntentId: "pi_first",
      amount: 2000,
      idempotencyKey: `refund:${result.refundRecordId}`,
    });
    expect(result).toMatchObject({ stripeRefundId: "re_1", outcome: "revoked" });
    expect(op.revocations.refunds[0]).toMatchObject({
      stripeSubscriptionId: "sub_1",
      invoiceId: "in_first",
      amount: 2000,
      stripeRefundId: "re_1",
      revokedAt: NOW,
    });
    await op.expectNotAdmitted();
    await expect(op.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(NOW_IN_STRIPE),
    });
    expect(op.deps.confirmRefund).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      refundRecordId: result.refundRecordId,
    });
  });

  it("makes no Stripe call when the journal write fails, leaving access unchanged", async () => {
    const op = await operator();
    op.journal.write.mockRejectedValueOnce(new Error("journal down"));

    await expect(refundInvoice(op.deps, { invoiceId: "in_first", now: NOW })).rejects.toThrow(
      /journal down/,
    );

    expect(op.deps.createRefund).not.toHaveBeenCalled();
    await op.expectAdmitted();
  });

  it("explains a refund whose response was lost: the delivered refund matches the record", async () => {
    const op = await operator();
    vi.mocked(op.deps.createRefund).mockImplementationOnce(async () => {
      throw new Error("connection reset after Stripe created the refund");
    });

    await expect(refundInvoice(op.deps, { invoiceId: "in_first", now: NOW })).rejects.toThrow(
      /connection reset/,
    );
    await op.expectAdmitted();

    const outcome = await applyStripeRefund(op.deps, {
      id: "re_lost",
      paymentIntentId: "pi_first",
      amount: 2000,
      createdAt: NOW_IN_STRIPE,
      status: "succeeded",
    });

    expect(outcome).toBe("revoked");
    expect(op.revocations.refunds[0]).toMatchObject({ stripeRefundId: "re_lost" });
    await op.expectNotAdmitted();
  });

  it("resumes an unfinished record when run again, so Stripe answers with the one refund it made", async () => {
    const op = await operator();
    vi.mocked(op.deps.createRefund).mockImplementationOnce(async (input) => {
      // Stripe makes the refund, and the response is lost on the way back.
      await op.deps.createRefund(input);
      throw new Error("connection reset after Stripe created the refund");
    });
    await expect(refundInvoice(op.deps, { invoiceId: "in_first", now: NOW })).rejects.toThrow(
      /connection reset/,
    );

    const result = await refundInvoice(op.deps, { invoiceId: "in_first", now: NOW });

    expect(op.revocations.refunds).toHaveLength(1);
    expect(result).toMatchObject({ stripeRefundId: "re_1", outcome: "revoked" });
    const keys = vi.mocked(op.deps.createRefund).mock.calls.map(([call]) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    await op.expectNotAdmitted();
  });

  it("refuses an invoice already refunded, writing nothing", async () => {
    const op = await operator();
    await refundInvoice(op.deps, { invoiceId: "in_first", now: NOW });

    await expect(
      refundInvoice(op.deps, { invoiceId: "in_first", amount: 500, now: NOW }),
    ).rejects.toThrow(/already refunded as re_1/);

    expect(op.revocations.refunds).toHaveLength(1);
    expect(op.deps.createRefund).toHaveBeenCalledOnce();
  });

  it("revokes nothing and leaves the record open when Stripe reports the refund failed", async () => {
    const op = await operator();
    op.refundFails();

    await expect(
      refundInvoice(op.deps, { invoiceId: "in_first", now: NOW }),
    ).resolves.toMatchObject({ outcome: "not_refunded" });

    await op.expectAdmitted();
    expect(op.revocations.refunds[0]).toMatchObject({ stripeRefundId: null, revokedAt: null });
    await expect(
      op.revocations.revocations.listSubscriptionRevocationBlocks({
        stripeSubscriptionId: "sub_1",
      }),
    ).resolves.toEqual([]);
    expect(op.deps.confirmRefund).not.toHaveBeenCalled();
  });

  it("refuses an amount beyond what was paid before writing anything", async () => {
    const op = await operator();

    await expect(
      refundInvoice(op.deps, { invoiceId: "in_first", amount: 2001, now: NOW }),
    ).rejects.toThrow(/between 1 and the 2000/);

    expect(op.steps).toEqual([]);
  });
});

describe("re-admission after a won dispute (#617, ADR 0248)", () => {
  it("revokes on the dispute, then restores on the same subscription once a grant names it", async () => {
    const op = await operator();
    await op.disputed("du_1");
    await op.expectNotAdmitted();
    op.disputeStatuses.set("du_1", "won");

    const result = await readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_1", now: NOW });

    expect(result).toEqual({ restored: true, grantId: expect.any(String) });
    expect(op.steps).toEqual(["record:grant", "journal:grant", "stripe:resume"]);
    expect(op.journaled).toEqual([
      { kind: "grant", accountId: user.id, actionId: result.grantId, at: NOW },
    ]);
    await op.expectAdmitted();
    await expect(op.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      retentionDeadline: null,
      paidAccessSubscriptionId: "sub_1",
    });
    expect(op.stripeSubscriptions.recorded.get("sub_1")).toMatchObject({ cancelAt: null });
  });

  it("is void against a later dispute", async () => {
    const op = await operator();
    await op.disputed("du_1", "won");
    await readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_1", now: NOW });
    await op.expectAdmitted();

    await op.disputed("du_2");

    await op.expectNotAdmitted();
    // Running the first grant again restores nothing: it names only du_1.
    await expect(
      readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_1", now: NOW }),
    ).resolves.toMatchObject({ restored: false, reason: "still_revoked" });
    await op.expectNotAdmitted();
    expect(op.revocations.exceptions).toHaveLength(1);
  });

  it("refuses a dispute that is not won, writing nothing", async () => {
    const op = await operator();
    await op.disputed("du_1", "under_review");

    await expect(
      readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_1", now: NOW }),
    ).rejects.toThrow(/under_review, not won/);

    expect(op.revocations.exceptions).toEqual([]);
    expect(op.journal.write).not.toHaveBeenCalled();
    await op.expectNotAdmitted();
  });

  it("refuses a dispute not yet on record", async () => {
    const op = await operator();

    await expect(
      readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_unknown", now: NOW }),
    ).rejects.toThrow(/No dispute du_unknown is on record/);
  });

  it("restores nothing on a subscription that has since ended: the customer resubscribes", async () => {
    const op = await operator();
    await op.disputed("du_1", "won");
    op.stripeSubscriptions.stripeChanges("sub_1", { endedAt: NOW, cancelAt: null });

    await expect(
      readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_1", now: NOW }),
    ).resolves.toMatchObject({ restored: false, reason: "subscription_ended" });

    await op.expectNotAdmitted();
    expect(op.deps.resumeRenewal).not.toHaveBeenCalled();
  });

  it("refuses a terminated account before writing a grant, leaving its renewal stopped (#630)", async () => {
    const op = await operator();
    await op.disputed("du_1", "won");
    await runOperatorCommand(op.deps, ["terminate", user.id, "Abuse"]);

    await expect(readmitAfterWonDispute(op.deps, { stripeDisputeId: "du_1" })).rejects.toThrow(
      `Account ${user.id} is terminated; a termination is permanent.`,
    );

    expect(op.revocations.exceptions).toEqual([]);
    expect(op.deps.resumeRenewal).not.toHaveBeenCalled();
    await op.expectNotAdmitted();
  });
});

describe("reading a refundable invoice", () => {
  const paidInvoice = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "in_first",
      status: "paid",
      customer: CUSTOMER,
      amount_paid: 2000,
      parent: { subscription_details: { subscription: "sub_1" } },
      payments: {
        data: [
          { status: "canceled", payment: { payment_intent: "pi_abandoned" } },
          { status: "paid", payment: { payment_intent: { id: "pi_first" } } },
        ],
      },
      ...overrides,
    }) as unknown as Parameters<typeof refundableInvoice>[0];

  it("reads the subscription, customer, amount, and the payment that paid it", () => {
    expect(refundableInvoice(paidInvoice())).toEqual({
      invoiceId: "in_first",
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: "sub_1",
      paymentIntentId: "pi_first",
      amountPaid: 2000,
    });
  });

  it("refuses an unpaid invoice and one outside a subscription", () => {
    expect(() => refundableInvoice(paidInvoice({ status: "open" }))).toThrow(/not a card-paid/);
    expect(() => refundableInvoice(paidInvoice({ parent: null }))).toThrow(/not a card-paid/);
  });
});

describe("the operator CLI's commands", () => {
  it("refunds an invoice, in full or by an amount", async () => {
    const op = await operator();

    await expect(
      runOperatorCommand(op.deps, ["refund", "in_first", "1500"]),
    ).resolves.toMatchObject({ outcome: "revoked" });
    expect(op.revocations.refunds[0]).toMatchObject({ amount: 1500 });
  });

  it("re-admits after a won dispute", async () => {
    const op = await operator();
    await op.disputed("du_1", "won");

    await expect(runOperatorCommand(op.deps, ["readmit-dispute", "du_1"])).resolves.toMatchObject({
      restored: true,
    });
  });

  it("suspends, renews, and lifts without a single Stripe call (#629)", async () => {
    const op = await operator();
    const stripeCalls = [
      op.deps.createRefund,
      op.deps.resumeRenewal,
      op.deps.retrieveSubscription,
      op.deps.cancelSubscription,
      op.deps.stopRenewal,
    ];

    await expect(
      runOperatorCommand(op.deps, ["suspend", user.id, "Reported", "abuse"]),
    ).resolves.toMatchObject({ resumed: false });
    await op.expectNotAdmitted();
    expect(op.suspensions.suspensions[0]).toMatchObject({ reason: "Reported abuse" });

    await runOperatorCommand(op.deps, ["renew-suspension", user.id]);
    await runOperatorCommand(op.deps, ["lift-suspension", user.id]);
    await op.expectAdmitted();

    expect(op.steps).toEqual([
      "record:suspension",
      "sessions:revoked",
      "journal:suspension",
      "record:renewal",
      "record:lift",
      "journal:suspension-lift",
    ]);
    for (const call of stripeCalls) expect(call).not.toHaveBeenCalled();
  });

  it("refuses anything else with the usage, touching nothing", async () => {
    const op = await operator();

    for (const argv of [
      [],
      ["refund"],
      ["refund", "in_first", "1500", "extra"],
      ["readmit-dispute", "du_1", "extra"],
      ["delete", "x"],
      ["toString", "x"],
      ["suspend", user.id],
      ["lift-suspension", user.id, "extra"],
    ]) {
      await expect(runOperatorCommand(op.deps, argv)).rejects.toThrow(OPERATOR_USAGE);
    }
    expect(op.steps).toEqual([]);
  });
});
