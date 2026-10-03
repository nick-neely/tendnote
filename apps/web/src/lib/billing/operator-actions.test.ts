import {
  type AdmissionPolicy,
  lapsedRetentionDeadline,
  type RecoveryJournalRecord,
} from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import {
  type OperatorActionDependencies,
  readmitAfterWonDispute,
  refundInvoice,
} from "./operator-actions";
import { applyStripeDispute, applyStripeRefund } from "./paid-access-revocation";
import { createPaidAccessRevocationsFake } from "./paid-access-revocations-fake";
import { createStripeSubscriptionsFake } from "./stripe-subscriptions-fake";

const user = { id: "subscriber-1", email: "subscriber@example.com" };
const CUSTOMER = "cus_subscriber";
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
const NOW = new Date("2026-10-03T12:00:00.000Z");
const DISPUTED_AT = new Date("2026-10-02T08:00:00.000Z");

/**
 * The Operator Actions over the web and Eve halves of admission, one Access
 * Profile store, Stripe's subscriptions, and an in-memory Recovery Journal.
 * `steps` records the order records, the journal, and Stripe were touched in.
 */
async function operator() {
  const harness = createAdmissionHarness({
    policy: hosted,
    evaluateFlag: vi.fn().mockResolvedValue(false),
    user,
  });
  const steps: string[] = [];
  const stripeSubscriptions = createStripeSubscriptionsFake(harness.queries, {
    stripeCustomerId: CUSTOMER,
    now: () => NOW,
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
  let refunds = 0;

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
    createRefund: vi.fn(async ({ amount }: { amount: number }) => {
      steps.push("stripe:refund");
      refunds += 1;
      return {
        id: `re_${refunds}`,
        paymentIntentId: "pi_first",
        amount,
        createdAt: NOW,
        status: "succeeded",
      };
    }),
    retrieveDisputeStatus: async (id) => disputeStatuses.get(id) ?? "needs_response",
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
    stripeSubscriptions,
    disputeStatuses,
    disputed,
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
      retentionDeadline: lapsedRetentionDeadline(NOW),
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
      createdAt: new Date(NOW.getTime() + 500),
      status: "succeeded",
    });

    expect(outcome).toBe("revoked");
    expect(op.revocations.refunds[0]).toMatchObject({ stripeRefundId: "re_lost" });
    await op.expectNotAdmitted();
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
});
