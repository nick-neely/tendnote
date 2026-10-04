import type { SuspensionCredit } from "@tendnote/db/queries/suspension-credits";
import {
  type AdmissionPolicy,
  lapsedRetentionDeadline,
  type RecoveryJournalRecord,
} from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { suspendAccount } from "../access/temporary-suspension";
import { createTemporarySuspensionsFake } from "../access/temporary-suspensions-fake";
import { createTerminationsFake } from "../access/terminations-fake";
import { createCeilingOverridesFake } from "./account-ceiling-overrides-fake";
import {
  liftSuspensionWithCredit,
  OPERATOR_USAGE,
  type OperatorActionDependencies,
  readmitAfterWonDispute,
  refundableInvoice,
  refundInvoice,
  runOperatorCommand,
  terminateAccountWithCredit,
} from "./operator-actions";
import { suspensionCreditMetadata } from "./operator-record-metadata";
import {
  applyStripeDispute,
  applyStripeRefund,
  type RefundSnapshot,
} from "./paid-access-revocation";
import { createPaidAccessRevocationsFake } from "./paid-access-revocations-fake";
import { createStripeSubscriptionsFake } from "./stripe-subscriptions-fake";
import {
  type CreditableInvoice,
  creditableInvoice,
  suspensionCreditStripeCalls,
} from "./suspension-credit";

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
  const ceilingOverrides = createCeilingOverridesFake({
    period: { start: "2026-09-15", resetsOn: "2026-10-15" },
  });
  const journaled: RecoveryJournalRecord[] = [];
  const journal = {
    write: vi.fn(async (record: RecoveryJournalRecord) => {
      journaled.push(record);
      steps.push(`journal:${record.kind}`);
    }),
  };
  const disputeStatuses = new Map<string, string>();
  const refundsByKey = new Map<string, RefundSnapshot>();
  const paidInvoices: CreditableInvoice[] = [];
  const creditNotesByKey = new Map<string, { id: string; stripeRefundId: string | null }>();
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
    getSuspension: async ({ userId, id }) =>
      suspensions.suspensions.find((each) => each.userId === userId && each.id === id) ?? null,
    credits: revocations.credits,
    dunning: stripeSubscriptions.dunning,
    ceilings: ceilingOverrides.ceilings,
    findStripeCustomer: async ({ userId }) => (userId === user.id ? CUSTOMER : null),
    listCreditableInvoices: vi.fn(async (customer: string) =>
      customer === CUSTOMER ? [...paidInvoices] : [],
    ),
    // Stripe Tax adds ten per cent on the credited line.
    previewCreditNote: vi.fn(async ({ lineAmount }) => lineAmount + Math.floor(lineAmount / 10)),
    // Stripe's idempotency again: one record, one credit note, and a card one refunds.
    createCreditNote: vi.fn(async ({ instrument, suspensionCreditId }) => {
      steps.push("stripe:credit-note");
      const n = creditNotesByKey.size + 1;
      const note = creditNotesByKey.get(suspensionCreditId) ?? {
        id: `cn_${n}`,
        stripeRefundId: instrument === "card" ? `re_cn_${n}` : null,
      };
      creditNotesByKey.set(suspensionCreditId, note);
      return note;
    }),
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
    ceilingOverrides,
    disputeStatuses,
    disputed,
    paidInvoices,
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
      // What a restore that lost the record rebuilds it from (#723).
      metadata: {
        refund_record: result.refundRecordId,
        invoice: "in_first",
        subscription: "sub_1",
      },
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

  it("suspends and renews without a Stripe call, and a lift with nothing paid credits nothing (#629)", async () => {
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

  it("extends dunning on a failed invoice and raises a ceiling, neither touching Stripe (#633)", async () => {
    const op = await operator();
    const failed = { invoiceId: "in_renewal", since: new Date("2026-10-01T12:00:00.000Z") };
    await op.deps.subscriptions.recordSubscription({
      userId: user.id,
      stripeSubscriptionId: "sub_1",
      cancelAt: null,
      endedAt: null,
      pastDue: failed,
    });

    await expect(
      runOperatorCommand(op.deps, ["extend-dunning", "in_renewal", "3"]),
    ).resolves.toMatchObject({
      invoiceId: "in_renewal",
      extendedUntil: new Date("2026-10-11T12:00:00.000Z"),
    });
    await expect(
      runOperatorCommand(op.deps, ["raise-ceiling", user.id, "web_search", "1.40"]),
    ).resolves.toMatchObject({
      costCategory: "web_search",
      ceilingUsd: 1.4,
      expiresOn: "2026-10-15",
    });

    expect(op.journaled.map((record) => record.kind)).toEqual(["grant", "ceiling-override"]);
    for (const call of [op.deps.retrieveSubscription, op.deps.cancelSubscription]) {
      expect(call).not.toHaveBeenCalled();
    }
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
      ["extend-dunning", "in_renewal"],
      ["extend-dunning", "in_renewal", "3", "extra"],
      ["raise-ceiling", user.id, "interactive"],
      ["raise-ceiling", user.id, "interactive", "20", "extra"],
      ["extend-dunning", "in_renewal", "2.5"],
      ["extend-dunning", "in_renewal", ""],
      ["raise-ceiling", user.id, "interactive", "1e1"],
      ["raise-ceiling", user.id, "interactive", "-5"],
      ["raise-ceiling", user.id, "interactive", ""],
    ]) {
      await expect(runOperatorCommand(op.deps, argv)).rejects.toThrow(OPERATOR_USAGE);
    }
    expect(op.steps).toEqual([]);
  });
});

describe("the Suspension Credit (#631, ADR 0249)", () => {
  const SUSPENDED_AT = new Date("2026-10-10T00:00:00.000Z");
  const LIFTED_AT = new Date("2026-10-16T00:00:00.000Z");
  /** A thirty-day period for 1500 cents, paid by `pi_oct`. */
  const october: CreditableInvoice = {
    invoiceId: "in_oct",
    stripeSubscriptionId: "sub_1",
    paymentIntentId: "pi_oct",
    invoiceLineItemId: "il_oct",
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-10-31T00:00:00.000Z"),
    lineAmount: 1500,
  };
  const november: CreditableInvoice = {
    invoiceId: "in_nov",
    stripeSubscriptionId: "sub_1",
    paymentIntentId: "pi_nov",
    invoiceLineItemId: "il_nov",
    periodStart: october.periodEnd,
    periodEnd: new Date("2026-11-30T00:00:00.000Z"),
    // A renewal at a different price: each invoice is credited by its own line.
    lineAmount: 1200,
  };

  async function suspended(...invoices: CreditableInvoice[]) {
    const op = await operator();
    op.paidInvoices.push(...invoices);
    await suspendAccount(op.deps, { userId: user.id, reason: "Review", now: SUSPENDED_AT });
    op.steps.length = 0;
    return op;
  }

  it("credits the suspended days to the balance at a lift when a renewal will consume it", async () => {
    const op = await suspended(october);

    const result = await liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT });

    expect(op.steps).toEqual([
      "record:lift",
      "journal:suspension-lift",
      "record:suspension-credit",
      "journal:suspension-credit",
      "stripe:credit-note",
    ]);
    // Six of thirty days of 1500, and the previewed tax on top.
    expect(op.deps.createCreditNote).toHaveBeenCalledExactlyOnceWith({
      invoiceId: "in_oct",
      invoiceLineItemId: "il_oct",
      lineAmount: 300,
      suspensionCreditId: "suspension-credit-1",
      instrument: "balance",
      amount: 330,
      // The whole record, for a restore that lost it to rebuild (#723).
      metadata: suspensionCreditMetadata(op.revocations.suspensionCredits[0] as SuspensionCredit),
    });
    expect(result.suspensionCredits).toEqual([
      {
        suspensionCreditId: "suspension-credit-1",
        invoiceId: "in_oct",
        suspendedAmount: 300,
        remainderAmount: 0,
        amount: 330,
        instrument: "balance",
        stripeCreditNoteId: "cn_1",
      },
    ]);
    expect(op.revocations.suspensionCredits[0]).toMatchObject({
      suspensionId: result.suspensionId,
      terminationId: null,
      requestedAt: LIFTED_AT,
    });
    expect(op.journaled.at(-1)).toEqual({
      kind: "suspension-credit",
      accountId: user.id,
      actionId: "suspension-credit-1",
      at: LIFTED_AT,
    });
    await op.expectAdmitted();
  });

  it("issues one credit note per paid invoice the suspension overlapped, each by its own net", async () => {
    const op = await suspended(november, october);

    const result = await liftSuspensionWithCredit(op.deps, {
      userId: user.id,
      now: new Date("2026-11-15T00:00:00.000Z"),
    });

    // Twenty-one days of October's 1500, fifteen of November's 1200.
    expect(
      result.suspensionCredits.map(({ invoiceId, suspendedAmount }) => [
        invoiceId,
        suspendedAmount,
      ]),
    ).toEqual([
      ["in_oct", 1050],
      ["in_nov", 600],
    ]);
    expect(op.deps.createCreditNote).toHaveBeenCalledTimes(2);
  });

  it("credits nothing for an invoice the suspension did not overlap, or under a cent", async () => {
    // Ten seconds of October is far under a cent; November is not overlapped at all.
    const op = await suspended(october, november);

    const result = await liftSuspensionWithCredit(op.deps, {
      userId: user.id,
      now: new Date("2026-10-10T00:00:10.000Z"),
    });

    expect(result.suspensionCredits).toEqual([]);
    expect(op.revocations.suspensionCredits).toEqual([]);
    expect(op.deps.createCreditNote).not.toHaveBeenCalled();
  });

  it("refunds a cancelled customer to the card, and that refund never revokes", async () => {
    const op = await suspended(october);
    op.stripeSubscriptions.stripeChanges("sub_1", { cancelAt: october.periodEnd });

    await liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT });

    expect(op.deps.createCreditNote).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: "card", amount: 330 }),
    );
    expect(op.revocations.suspensionCredits[0]).toMatchObject({
      stripeCreditNoteId: "cn_1",
      stripeRefundId: "re_cn_1",
    });
    const outcome = await applyStripeRefund(op.deps, {
      id: "re_cn_1",
      paymentIntentId: "pi_oct",
      amount: 330,
      createdAt: LIFTED_AT,
      status: "succeeded",
    });
    expect(outcome).toBe("suspension_credit");
    expect(op.deps.cancelSubscription).not.toHaveBeenCalled();
    expect(op.deps.confirmRefund).not.toHaveBeenCalled();
    await op.expectAdmitted();
  });

  it("caps the credited time at a cancellation that took effect during the review", async () => {
    const op = await suspended(october);
    op.stripeSubscriptions.stripeChanges("sub_1", {
      cancelAt: new Date("2026-10-13T00:00:00.000Z"),
      endedAt: new Date("2026-10-13T00:00:00.000Z"),
    });

    const result = await liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT });

    // Three days, not six, and back to the card: no renewal is coming.
    expect(result.suspensionCredits).toMatchObject([{ suspendedAmount: 150, instrument: "card" }]);
  });

  it("matches a card refund Stripe announced before the credit note call returned, and resumes once", async () => {
    const op = await suspended(october);
    op.stripeSubscriptions.stripeChanges("sub_1", { cancelAt: october.periodEnd });
    vi.mocked(op.deps.createCreditNote).mockImplementationOnce(async (input) => {
      await op.deps.createCreditNote(input);
      throw new Error("connection reset after Stripe created the credit note");
    });
    await expect(
      liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT }),
    ).rejects.toThrow(/connection reset/);

    // The refund's webhook finds the record by payment, amount, and time.
    await expect(
      applyStripeRefund(op.deps, {
        id: "re_cn_1",
        paymentIntentId: "pi_oct",
        amount: 330,
        createdAt: new Date(LIFTED_AT.getTime() - 500),
        status: "succeeded",
      }),
    ).resolves.toBe("suspension_credit");
    expect(op.revocations.suspensionCredits[0]).toMatchObject({ stripeRefundId: "re_cn_1" });

    const rerun = await liftSuspensionWithCredit(op.deps, { userId: user.id });

    expect(rerun).toMatchObject({
      resumed: true,
      suspensionCredits: [{ stripeCreditNoteId: "cn_1" }],
    });
    expect(op.revocations.suspensionCredits).toHaveLength(1);
    const records = vi
      .mocked(op.deps.createCreditNote)
      .mock.calls.map(([call]) => call.suspensionCreditId);
    expect(new Set(records)).toEqual(new Set(["suspension-credit-1"]));
    await op.expectAdmitted();
  });

  it("never credits an exit twice when run again after it finished", async () => {
    const op = await suspended(october);
    await liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT });

    await liftSuspensionWithCredit(op.deps, { userId: user.id });

    expect(op.revocations.suspensionCredits).toHaveLength(1);
    expect(op.deps.createCreditNote).toHaveBeenCalledOnce();
  });

  it("makes no credit note when the journal write fails, after the lift already restored access", async () => {
    const op = await suspended(october);
    op.journal.write.mockImplementation(async (record) => {
      if (record.kind === "suspension-credit") throw new Error("journal down");
      op.journaled.push(record);
    });

    await expect(
      liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT }),
    ).rejects.toThrow(/journal down/);

    expect(op.deps.createCreditNote).not.toHaveBeenCalled();
    await op.expectAdmitted();
  });

  it("puts a termination's unused remainder on the same credit note, back to the card", async () => {
    const op = await suspended(october);

    const result = await terminateAccountWithCredit(op.deps, {
      userId: user.id,
      reason: "Abuse",
      now: LIFTED_AT,
    });

    expect(op.steps.slice(-3)).toEqual([
      "record:suspension-credit",
      "journal:suspension-credit",
      "stripe:credit-note",
    ]);
    // Six suspended days and fifteen unused: 300 + 750, with tax.
    expect(op.deps.createCreditNote).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ lineAmount: 1050, instrument: "card", amount: 1155 }),
    );
    expect(result.suspensionCredits).toMatchObject([
      { suspendedAmount: 300, remainderAmount: 750, instrument: "card" },
    ]);
    expect(op.revocations.suspensionCredits[0]).toMatchObject({
      suspensionId: result.convertedSuspensionId,
      terminationId: result.terminationId,
    });
  });

  it("issues none for a termination that converted no suspension", async () => {
    const op = await operator();
    op.paidInvoices.push(october);

    const result = await terminateAccountWithCredit(op.deps, {
      userId: user.id,
      reason: "Abuse",
      now: new Date("2026-10-25T00:00:00.000Z"),
    });

    expect(result.suspensionCredits).toEqual([]);
    expect(op.deps.listCreditableInvoices).not.toHaveBeenCalled();
    expect(op.deps.createCreditNote).not.toHaveBeenCalled();
  });

  it("is not blocked by an invoice with no single line it never needed to credit", async () => {
    const op = await suspended({ ...november, invoiceLineItemId: null }, october);

    const result = await liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT });

    expect(result.suspensionCredits).toMatchObject([{ invoiceId: "in_oct" }]);
  });

  it("refuses to guess at an invoice with no single line it must credit, writing nothing", async () => {
    const op = await suspended({ ...october, invoiceLineItemId: null });

    await expect(
      liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT }),
    ).rejects.toThrow(/more than one subscription line/);
    expect(op.revocations.suspensionCredits).toEqual([]);
    await op.expectAdmitted();
  });

  it("alerts on a lost-id refund that fits both a Refund record and a Suspension Credit", async () => {
    const op = await suspended(october);
    op.stripeSubscriptions.stripeChanges("sub_1", { cancelAt: october.periodEnd });
    vi.mocked(op.deps.createCreditNote).mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      liftSuspensionWithCredit(op.deps, { userId: user.id, now: LIFTED_AT }),
    ).rejects.toThrow(/connection reset/);
    await op.revocations.records.recordRefund({
      userId: user.id,
      stripeSubscriptionId: "sub_1",
      invoiceId: "in_oct",
      paymentIntentId: "pi_oct",
      amount: 330,
      requestedAt: LIFTED_AT,
    });

    await expect(
      applyStripeRefund(op.deps, {
        id: "re_ambiguous",
        paymentIntentId: "pi_oct",
        amount: 330,
        createdAt: LIFTED_AT,
        status: "succeeded",
      }),
    ).resolves.toBe("unmatched");
    expect(op.revocations.refunds[0]).toMatchObject({ stripeRefundId: null });
    expect(op.revocations.suspensionCredits[0]).toMatchObject({ stripeRefundId: null });
    await op.expectAdmitted();
  });
});

describe("reading a creditable invoice (#631)", () => {
  const line = (overrides: Record<string, unknown> = {}) => ({
    id: "il_renewal",
    amount: 1500,
    discount_amounts: [{ amount: 300, discount: "di_1" }],
    period: { start: 1_790_812_800, end: 1_793_404_800 },
    parent: {
      type: "subscription_item_details",
      subscription_item_details: { proration: false, subscription_item: "si_1" },
    },
    ...overrides,
  });
  const invoice = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "in_renewal",
      status: "paid",
      customer: CUSTOMER,
      // The invoice's own period is the one before; the line's is the one paid for.
      period_start: 1_788_220_800,
      period_end: 1_790_812_800,
      parent: { subscription_details: { subscription: "sub_1" } },
      lines: { data: [line()] },
      payments: { data: [{ status: "paid", payment: { payment_intent: "pi_renewal" } }] },
      ...overrides,
    }) as unknown as Parameters<typeof creditableInvoice>[0];

  it("reads the renewal line's own period and its amount before discounts, which Stripe applies", () => {
    expect(creditableInvoice(invoice())).toEqual({
      invoiceId: "in_renewal",
      stripeSubscriptionId: "sub_1",
      paymentIntentId: "pi_renewal",
      invoiceLineItemId: "il_renewal",
      periodStart: new Date(1_790_812_800 * 1000),
      periodEnd: new Date(1_793_404_800 * 1000),
      lineAmount: 1500,
    });
  });

  it("ignores prorations and skips an invoice with no renewal line", () => {
    const proration = line({
      id: "il_proration",
      parent: {
        type: "subscription_item_details",
        subscription_item_details: { proration: true, subscription_item: "si_1" },
      },
    });

    expect(creditableInvoice(invoice({ lines: { data: [proration, line()] } }))).toMatchObject({
      invoiceLineItemId: "il_renewal",
    });
    expect(creditableInvoice(invoice({ lines: { data: [proration] } }))).toBeNull();
  });

  it("is not creditable unpaid or outside a subscription, and names no line when two renew", () => {
    expect(creditableInvoice(invoice({ status: "open" }))).toBeNull();
    expect(creditableInvoice(invoice({ parent: null }))).toBeNull();
    expect(
      creditableInvoice(invoice({ lines: { data: [line(), line({ id: "il_second" })] } })),
    ).toMatchObject({ invoiceLineItemId: null });
  });
});

type StripeClient = Parameters<typeof suspensionCreditStripeCalls>[0];

describe("the Suspension Credit's Stripe calls (#631)", () => {
  const line = { invoiceId: "in_oct", invoiceLineItemId: "il_oct", lineAmount: 300 };

  /** Stripe's credit notes on one invoice, listed and created like the client does. */
  function stripeWith(existing: Record<string, unknown>[] = []) {
    const creditNotes = {
      list: vi.fn(async function* () {
        yield* existing;
      }),
      preview: vi.fn(async () => ({ total: 330 })),
      create: vi.fn(async () => ({ id: "cn_new", refunds: [{ refund: { id: "re_new" } }] })),
    };
    const invoices = {
      list: vi.fn(async function* () {
        yield {
          id: "in_oct",
          status: "paid",
          customer: CUSTOMER,
          parent: { subscription_details: { subscription: "sub_1" } },
          lines: {
            data: [
              {
                id: "il_oct",
                amount: 1500,
                period: { start: 1_790_812_800, end: 1_793_404_800 },
                parent: {
                  type: "subscription_item_details",
                  subscription_item_details: { proration: false },
                },
              },
            ],
          },
          payments: { data: [{ status: "paid", payment: { payment_intent: "pi_oct" } }] },
        };
        yield { id: "in_one_off", status: "paid", customer: CUSTOMER, parent: null };
      }),
    };
    const calls = suspensionCreditStripeCalls(
      () => ({ creditNotes, invoices }) as unknown as ReturnType<StripeClient>,
    );
    return { calls, creditNotes, invoices };
  }

  it("lists only the customer's paid subscription invoices", async () => {
    const { calls, invoices } = stripeWith();

    await expect(calls.listCreditableInvoices(CUSTOMER)).resolves.toMatchObject([
      { invoiceId: "in_oct", invoiceLineItemId: "il_oct", paymentIntentId: "pi_oct" },
    ]);
    expect(invoices.list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER, status: "paid" }),
    );
  });

  it("previews the total for the subscription line credited by amount", async () => {
    const { calls, creditNotes } = stripeWith();

    await expect(calls.previewCreditNote(line)).resolves.toBe(330);
    expect(creditNotes.preview).toHaveBeenCalledWith({
      invoice: "in_oct",
      lines: [{ type: "invoice_line_item", invoice_line_item: "il_oct", amount: 300 }],
    });
  });

  it("creates the credit note under the record's key, refunding the card or crediting the balance", async () => {
    const { calls, creditNotes } = stripeWith();

    await expect(
      calls.createCreditNote({
        ...line,
        suspensionCreditId: "sc-1",
        instrument: "card",
        amount: 330,
        metadata: { suspension_credit: "sc-1", instrument: "card" },
      }),
    ).resolves.toEqual({ id: "cn_new", stripeRefundId: "re_new" });
    expect(creditNotes.create).toHaveBeenCalledWith(
      {
        invoice: "in_oct",
        lines: [{ type: "invoice_line_item", invoice_line_item: "il_oct", amount: 300 }],
        refund_amount: 330,
        metadata: { suspension_credit: "sc-1", instrument: "card" },
      },
      { idempotencyKey: "suspension-credit:sc-1" },
    );

    await calls.createCreditNote({
      ...line,
      suspensionCreditId: "sc-2",
      instrument: "balance",
      amount: 330,
      metadata: { suspension_credit: "sc-2" },
    });
    expect(creditNotes.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ credit_amount: 330 }),
      { idempotencyKey: "suspension-credit:sc-2" },
    );
  });

  it("returns the credit note a lost response left behind instead of creating another", async () => {
    const { calls, creditNotes } = stripeWith([
      { id: "cn_other", metadata: {}, refunds: [] },
      { id: "cn_lost", metadata: { suspension_credit: "sc-1" }, refunds: [{ refund: "re_lost" }] },
    ]);

    await expect(
      calls.createCreditNote({
        ...line,
        suspensionCreditId: "sc-1",
        instrument: "card",
        amount: 330,
        metadata: { suspension_credit: "sc-1" },
      }),
    ).resolves.toEqual({ id: "cn_lost", stripeRefundId: "re_lost" });
    expect(creditNotes.create).not.toHaveBeenCalled();
  });
});
