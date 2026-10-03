import type { AdmissionPolicy } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { createStripeReconciliation, RECONCILIATION_LOOKBACK_MS } from "./stripe-reconciliation";

const user = { id: "subscriber-1", email: "subscriber@example.com" };
const CUSTOMER = "cus_subscriber";
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };
const NOW = new Date("2026-10-03T12:00:00Z");
/** 2026-10-01T09:30:00Z, when the fixture subscription started. */
const SUBSCRIPTION_STARTED = 1790847000;

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: "in_first",
    object: "invoice",
    customer: CUSTOMER,
    status: "paid",
    billing_reason: "subscription_create",
    period_start: SUBSCRIPTION_STARTED,
    period_end: SUBSCRIPTION_STARTED,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_1", metadata: {} },
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

/**
 * Stripe's current paid invoices, listed the way the real client pages them.
 * `failAfter` makes the listing break partway, as a Stripe outage would.
 */
function fakeStripe(current: () => Stripe.Invoice[], options: { failAfter?: number } = {}) {
  const list = vi.fn((_params: Stripe.InvoiceListParams) =>
    (async function* () {
      let yielded = 0;
      for (const paid of current()) {
        if (options.failAfter !== undefined && yielded >= options.failAfter) {
          throw new Error("Stripe is unavailable");
        }
        yielded += 1;
        yield paid;
      }
    })(),
  );
  return { invoices: { list } };
}

/**
 * The web and Eve halves of admission over one Access Profile store, with the
 * reconciliation job writing into that same store the way production wires it.
 * Stripe holds a paid first invoice whose webhook never arrived.
 */
function droppedWebhook(
  input: {
    policy?: AdmissionPolicy;
    invoices?: Stripe.Invoice[];
    customers?: [string, string][];
    failAfter?: number;
  } = {},
) {
  const policy = input.policy ?? hosted;
  const harness = createAdmissionHarness({
    policy,
    evaluateFlag: vi.fn().mockResolvedValue(false),
    user,
  });
  const stripeInvoices = input.invoices ?? [invoice()];
  const stripe = fakeStripe(() => stripeInvoices, { failAfter: input.failAfter });
  const customers = new Map([[CUSTOMER, user.id], ...(input.customers ?? [])]);
  const anchors = new Map<string, Date>();
  const logger = { warn: vi.fn(), error: vi.fn() };
  const announceAdmission = vi.fn(async (_input: { userId: string; invoiceId: string }) => {
    const profile = await harness.queries.getAccessProfile({ userId: user.id });
    if (profile?.status !== "granted") throw new Error("announced before admission");
  });
  const grantPaidAccess = vi.fn((userId: string) =>
    harness.queries.grantAccess({ userId, source: "paid_access" }),
  );
  const reconcile = createStripeReconciliation({
    policy,
    stripe,
    findAccountByStripeCustomer: async (id) => {
      if (id === "cus_lookup_fails") throw new Error("database unavailable");
      return customers.get(id) ?? null;
    },
    readAccessProfile: (userId) => harness.queries.getAccessProfile({ userId }),
    grantPaidAccess,
    anchorUsagePeriod: async (userId, startedAt) => {
      anchors.set(userId, startedAt);
    },
    announceAdmission,
    logger,
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

  return {
    ...harness,
    reconcile: () => reconcile({ now: NOW }),
    stripe,
    stripeInvoices,
    anchors,
    logger,
    announceAdmission,
    grantPaidAccess,
    expectAdmitted,
    expectNotAdmitted,
  };
}

async function signedUp(input?: Parameters<typeof droppedWebhook>[0]) {
  const subscriber = droppedWebhook(input);
  await subscriber.queries.ensureAccessProfile({ userId: user.id });
  return subscriber;
}

describe("Stripe reconciliation", () => {
  it("repairs a dropped first-invoice webhook on the next pass", async () => {
    const subscriber = await signedUp();
    await subscriber.expectNotAdmitted();

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ status: "ran", admitted: 1, failed: 0 });
    await subscriber.expectAdmitted();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      status: "granted",
      source: "paid_access",
    });
    expect(subscriber.anchors.get(user.id)).toEqual(new Date(SUBSCRIPTION_STARTED * 1000));
    expect(subscriber.announceAdmission).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      invoiceId: "in_first",
    });
    await expect(subscriber.announceAdmission.mock.results[0]?.value).resolves.toBeUndefined();
  });

  it("reads only paid invoices Stripe created inside the lookback window", async () => {
    const subscriber = await signedUp();

    await subscriber.reconcile();

    expect(subscriber.stripe.invoices.list).toHaveBeenCalledExactlyOnceWith({
      status: "paid",
      created: { gte: Math.floor((NOW.getTime() - RECONCILIATION_LOOKBACK_MS) / 1000) },
      limit: 100,
    });
  });

  it("is idempotent: a second pass changes nothing and sends nothing", async () => {
    const subscriber = await signedUp();

    await subscriber.reconcile();
    const second = await subscriber.reconcile();

    expect(second).toMatchObject({ status: "ran", admitted: 0, failed: 0 });
    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
    await subscriber.expectAdmitted();
  });

  it("leaves an account the webhook already admitted alone and sends no second email", async () => {
    const subscriber = await signedUp();
    await subscriber.queries.grantAccess({ userId: user.id, source: "paid_access" });

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ admitted: 0, failed: 0 });
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
  });

  it("admits nobody for a renewal, an unpaid invoice, or a paid invoice outside a subscription", async () => {
    const subscriber = await signedUp({
      invoices: [
        invoice({ id: "in_renewal", billing_reason: "subscription_cycle" }),
        invoice({ id: "in_open", status: "open" }),
        invoice({ id: "in_one_off", parent: null }),
      ],
    });

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ admitted: 0, failed: 0 });
    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
  });

  it("admits nobody for a customer Tendnote never created, and says so", async () => {
    const subscriber = await signedUp({ invoices: [invoice({ customer: "cus_unknown" })] });

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ admitted: 0, unknownCustomer: 1, failed: 0 });
    expect(subscriber.logger.warn).toHaveBeenCalledWith(
      "stripe_reconciliation.unknown_customer",
      expect.objectContaining({ invoiceId: "in_first" }),
    );
    await subscriber.expectNotAdmitted();
  });
});

describe("Stripe reconciliation and operator records", () => {
  it("never overwrites an operator grant", async () => {
    const subscriber = await signedUp();
    await subscriber.queries.grantAccess({ userId: user.id, source: "manual_grant" });

    await subscriber.reconcile();

    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      status: "granted",
      source: "manual_grant",
    });
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
  });

  it("projects Paid Access without lifting an operator's block", async () => {
    const subscriber = await signedUp();
    const suspension = { kind: "temporary_suspension", event: "op_suspend_1", exceptions: [] };
    subscriber.blocks.set(user.id, [suspension]);

    await subscriber.reconcile();

    await subscriber.expectNotAdmitted();
    expect(subscriber.blocks.get(user.id)).toEqual([suspension]);
  });
});

describe("Stripe reconciliation failures", () => {
  it("goes on to the next invoice after one fails to project", async () => {
    const subscriber = await signedUp({
      invoices: [invoice({ id: "in_other", customer: "cus_other" }), invoice()],
      customers: [["cus_other", "subscriber-2"]],
    });
    subscriber.grantPaidAccess.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ status: "ran", admitted: 1, failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith(
      "stripe_reconciliation.failed",
      expect.objectContaining({ invoiceId: "in_other", userId: "subscriber-2" }),
    );
    await subscriber.expectAdmitted();
  });

  it("records an alertable failure when projecting an invoice fails, and the next pass heals it", async () => {
    const subscriber = await signedUp();
    subscriber.grantPaidAccess.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    const failed = await subscriber.reconcile();

    expect(failed).toMatchObject({ status: "ran", admitted: 0, failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith("stripe_reconciliation.failed", {
      stage: "project",
      invoiceId: "in_first",
      userId: user.id,
      error: "database unavailable",
    });
    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();

    await expect(subscriber.reconcile()).resolves.toMatchObject({ admitted: 1, failed: 0 });
    await subscriber.expectAdmitted();
  });

  it("records an alertable failure when the account cannot be looked up, and goes on", async () => {
    const subscriber = await signedUp({
      invoices: [invoice({ id: "in_other", customer: "cus_lookup_fails" }), invoice()],
    });

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ admitted: 1, failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith("stripe_reconciliation.failed", {
      stage: "project",
      invoiceId: "in_other",
      error: "database unavailable",
    });
    await subscriber.expectAdmitted();
  });

  it("keeps the admission when the email fails, and records it", async () => {
    const subscriber = await signedUp();
    subscriber.announceAdmission.mockRejectedValueOnce(new Error("email provider unavailable"));

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ admitted: 1, failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith("stripe_reconciliation.failed", {
      stage: "announce",
      invoiceId: "in_first",
      userId: user.id,
      error: "email provider unavailable",
    });
    await subscriber.expectAdmitted();
  });

  it("records an alertable failure when Stripe cannot be read, without throwing", async () => {
    const subscriber = await signedUp({ failAfter: 0 });

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ status: "ran", admitted: 0, failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith("stripe_reconciliation.failed", {
      stage: "list",
      error: "Stripe is unavailable",
    });
    await subscriber.expectNotAdmitted();
  });
});

describe("self-hosted deployments", () => {
  it("run none of the reconciliation, even with a paid first invoice in Stripe", async () => {
    const subscriber = await signedUp({ policy: { mode: "self-hosted" } as AdmissionPolicy });

    const result = await subscriber.reconcile();

    expect(result).toEqual({ status: "skipped" });
    expect(subscriber.stripe.invoices.list).not.toHaveBeenCalled();
    expect(subscriber.grantPaidAccess).not.toHaveBeenCalled();
  });
});
