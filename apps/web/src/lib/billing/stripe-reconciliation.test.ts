import { type AdmissionPolicy, lapsedRetentionDeadline } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { createStripeReconciliation, RECONCILIATION_LOOKBACK_MS } from "./stripe-reconciliation";
import { createStripeSubscriptionsFake } from "./stripe-subscriptions-fake";
import { projectSubscription } from "./subscription-projection";

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
function fakeStripe(
  current: () => Stripe.Invoice[],
  options: { failAfter?: number; events?: () => Stripe.Event[] } = {},
) {
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
  // Stripe's recent subscription events, newest first as Stripe lists them.
  const listEvents = vi.fn((_params: Stripe.EventListParams) =>
    (async function* () {
      yield* options.events?.() ?? [];
    })(),
  );
  return { invoices: { list }, events: { list: listEvents } };
}

/** A subscription event whose own copy is deliberately stale: reconciliation re-reads Stripe. */
function subscriptionEvent(type: "updated" | "deleted", id = "sub_1"): Stripe.Event {
  return {
    id: `evt_${type}_${id}`,
    object: "event",
    type: `customer.subscription.${type}`,
    data: { object: { id, object: "subscription", customer: CUSTOMER, status: "active" } },
  } as unknown as Stripe.Event;
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
    events?: Stripe.Event[];
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
  const stripeEvents = input.events ?? [];
  const stripe = fakeStripe(() => stripeInvoices, {
    failAfter: input.failAfter,
    events: () => stripeEvents,
  });
  const customers = new Map([[CUSTOMER, user.id], ...(input.customers ?? [])]);
  const anchors = new Map<string, Date>();
  const logger = { warn: vi.fn(), error: vi.fn() };
  const announceAdmission = vi.fn(async (_input: { userId: string; invoiceId: string }) => {
    const profile = await harness.queries.getAccessProfile({ userId: user.id });
    if (profile?.status !== "granted") throw new Error("announced before admission");
  });
  const grantPaidAccess = vi.fn((userId: string, stripeSubscriptionId: string) =>
    harness.queries.grantAccess({ userId, source: "paid_access", stripeSubscriptionId }),
  );
  let clock = NOW;
  const stripeSubscriptions = createStripeSubscriptionsFake(harness.queries, {
    stripeCustomerId: CUSTOMER,
    now: () => clock,
  });
  const reconcile = createStripeReconciliation({
    policy,
    stripe,
    findAccountByStripeCustomer: async (id) => {
      if (id === "cus_lookup_fails") throw new Error("database unavailable");
      return customers.get(id) ?? null;
    },
    readAccessProfile: (userId) => harness.queries.getAccessProfile({ userId }),
    grantPaidAccess,
    retrieveSubscription: stripeSubscriptions.retrieveSubscription,
    subscriptions: stripeSubscriptions.subscriptions,
    listClosedDunningWindows: stripeSubscriptions.listClosedDunningWindows,
    cancelSubscription: stripeSubscriptions.cancelSubscription,
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
    /** One pass of the job, run at `at`, which is also when Stripe ends anything it cancels. */
    reconcile: (at = NOW) => {
      clock = at;
      return reconcile({ now: at });
    },
    stripe,
    stripeInvoices,
    stripeEvents,
    anchors,
    logger,
    announceAdmission,
    grantPaidAccess,
    stripeSubscriptions,
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

  it("never re-admits an account whose subscription ended, while its first invoice stays paid (#609)", async () => {
    const subscriber = await signedUp();
    await subscriber.reconcile();
    await subscriber.expectAdmitted();

    // The period ends; the webhook projects it and the account becomes Lapsed.
    const ended = new Date("2026-11-01T09:30:00Z");
    subscriber.stripeSubscriptions.stripeChanges("sub_1", { endedAt: ended });
    await projectSubscription(
      subscriber.stripeSubscriptions.subscriptions,
      user.id,
      await subscriber.stripeSubscriptions.retrieveSubscription("sub_1"),
    );
    await subscriber.expectNotAdmitted();

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ status: "ran", admitted: 0, failed: 0 });
    await subscriber.expectNotAdmitted();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(ended),
    });
    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
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

describe("Stripe reconciliation of subscription changes (#609)", () => {
  const PERIOD_END = new Date("2026-11-01T09:30:00Z");

  /**
   * An account admitted long enough ago that its first invoice has left the
   * lookback window, so only its subscription's own events can reach it.
   */
  async function paying(input?: Parameters<typeof droppedWebhook>[0]) {
    const subscriber = await signedUp(input);
    await subscriber.reconcile();
    await subscriber.expectAdmitted();
    subscriber.stripeInvoices.length = 0;
    return subscriber;
  }

  it("repairs a dropped subscription end: the account becomes Lapsed", async () => {
    const subscriber = await paying();

    subscriber.stripeSubscriptions.stripeChanges("sub_1", { endedAt: PERIOD_END });
    subscriber.stripeEvents.push(subscriptionEvent("deleted"));
    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ status: "ran", failed: 0 });
    await subscriber.expectNotAdmitted();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(PERIOD_END),
    });
  });

  it("repairs a dropped scheduled cancellation and confirms it once, however many passes see it", async () => {
    const subscriber = await paying();

    subscriber.stripeSubscriptions.stripeChanges("sub_1", { cancelAt: PERIOD_END });
    // Two events for one subscription are projected once per pass.
    subscriber.stripeEvents.push(subscriptionEvent("updated"), subscriptionEvent("updated"));
    await subscriber.reconcile();
    await subscriber.reconcile();

    await subscriber.expectAdmitted();
    expect(subscriber.stripeSubscriptions.recorded.get("sub_1")).toMatchObject({
      cancelAt: PERIOD_END,
      endedAt: null,
    });
    expect(subscriber.stripeSubscriptions.confirmCancellation).toHaveBeenCalledOnce();
    expect(subscriber.stripeSubscriptions.retrieveSubscription).toHaveBeenCalledTimes(3);
  });

  it("leaves a resubscribed account admitted when the old subscription's end is replayed", async () => {
    const resubscribed = invoice({
      id: "in_again",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_2", metadata: {} },
      },
    });
    const subscriber = await signedUp({ invoices: [resubscribed] });
    subscriber.stripeSubscriptions.stripeChanges("sub_1", { endedAt: PERIOD_END });
    subscriber.stripeSubscriptions.stripeChanges("sub_2", {});
    subscriber.stripeEvents.push(subscriptionEvent("deleted", "sub_1"));

    await subscriber.reconcile();

    await subscriber.expectAdmitted();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      paidAccessSubscriptionId: "sub_2",
      retentionDeadline: null,
    });
  });

  it("reads only subscription changes inside the lookback window", async () => {
    const subscriber = await signedUp();

    await subscriber.reconcile();

    expect(subscriber.stripe.events.list).toHaveBeenCalledExactlyOnceWith({
      types: ["customer.subscription.updated", "customer.subscription.deleted"],
      created: { gte: Math.floor((NOW.getTime() - RECONCILIATION_LOOKBACK_MS) / 1000) },
      limit: 100,
    });
  });

  it("records an alertable failure for a subscription it cannot read, and goes on", async () => {
    const subscriber = await paying();
    subscriber.stripeSubscriptions.stripeChanges("sub_1", { endedAt: PERIOD_END });
    subscriber.stripeEvents.push(
      subscriptionEvent("updated", "sub_gone"),
      subscriptionEvent("deleted"),
    );

    const result = await subscriber.reconcile();

    expect(result).toMatchObject({ status: "ran", failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith("stripe_reconciliation.failed", {
      stage: "subscription",
      stripeSubscriptionId: "sub_gone",
      error: "No such subscription: sub_gone",
    });
    await subscriber.expectNotAdmitted();
  });
});

describe("renewal failure: Past Due for seven days, then Lapsed (#610)", () => {
  /** When the renewal's payment first failed, a day after NOW's first pass. */
  const FAILED = new Date("2026-11-01T10:30:00Z");
  const WINDOW_CLOSES = new Date("2026-11-08T10:30:00Z");
  const renewal = { invoiceId: "in_renewal", since: FAILED };
  const atDay = (days: number) => new Date(FAILED.getTime() + days * 24 * 60 * 60 * 1000);

  /** A paying account whose renewal failed, recorded from its subscription's event. */
  async function pastDue() {
    const subscriber = await signedUp();
    await subscriber.reconcile();
    subscriber.stripeInvoices.length = 0;
    subscriber.stripeSubscriptions.stripeChanges("sub_1", { pastDue: renewal });
    subscriber.stripeEvents.push(subscriptionEvent("updated"));
    await subscriber.reconcile(atDay(0));
    return subscriber;
  }

  it("keeps a failed renewal admitted on web and Eve, recorded Past Due for its notice", async () => {
    const subscriber = await pastDue();

    await subscriber.expectAdmitted();
    expect(subscriber.stripeSubscriptions.recorded.get("sub_1")).toMatchObject({
      pastDue: renewal,
      endedAt: null,
    });
    expect(subscriber.stripeSubscriptions.cancelSubscription).not.toHaveBeenCalled();
  });

  it("stays admitted for the whole seven days", async () => {
    const subscriber = await pastDue();

    for (const day of [1, 3, 6, 6.99]) {
      expect(await subscriber.reconcile(atDay(day))).toMatchObject({ dunningClosed: 0 });
      await subscriber.expectAdmitted();
    }
    expect(subscriber.stripeSubscriptions.cancelSubscription).not.toHaveBeenCalled();
  });

  it("returns to Paid when the payment recovers inside the window, and the window never closes", async () => {
    const subscriber = await pastDue();

    subscriber.stripeSubscriptions.stripeChanges("sub_1", { pastDue: null });
    await subscriber.reconcile(atDay(4));
    await subscriber.reconcile(atDay(8));

    await subscriber.expectAdmitted();
    expect(subscriber.stripeSubscriptions.recorded.get("sub_1")?.pastDue).toBeNull();
    expect(subscriber.stripeSubscriptions.cancelSubscription).not.toHaveBeenCalled();
  });

  it("makes the account Lapsed when the window closes, ending the subscription in Stripe", async () => {
    const subscriber = await pastDue();

    const result = await subscriber.reconcile(WINDOW_CLOSES);

    expect(result).toMatchObject({ status: "ran", dunningClosed: 1, failed: 0 });
    expect(subscriber.stripeSubscriptions.cancelSubscription).toHaveBeenCalledExactlyOnceWith(
      "sub_1",
    );
    await subscriber.expectNotAdmitted();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      status: "pending",
      retentionDeadline: lapsedRetentionDeadline(WINDOW_CLOSES),
    });
  });

  it("closes the window once: later passes neither cancel again nor move the deadline", async () => {
    const subscriber = await pastDue();
    await subscriber.reconcile(WINDOW_CLOSES);

    await subscriber.reconcile(atDay(8));
    await subscriber.reconcile(atDay(9));

    expect(subscriber.stripeSubscriptions.cancelSubscription).toHaveBeenCalledOnce();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(WINDOW_CLOSES),
    });
  });

  it("does not end a subscription whose payment recovered after the record, though no event says so", async () => {
    const subscriber = await pastDue();
    subscriber.stripeEvents.length = 0;

    subscriber.stripeSubscriptions.stripeChanges("sub_1", { pastDue: null });
    const result = await subscriber.reconcile(atDay(8));

    expect(result).toMatchObject({ dunningClosed: 0, failed: 0 });
    expect(subscriber.stripeSubscriptions.cancelSubscription).not.toHaveBeenCalled();
    await subscriber.expectAdmitted();
    expect(subscriber.stripeSubscriptions.recorded.get("sub_1")?.pastDue).toBeNull();
  });

  it("gives a later failed invoice its own seven days rather than the first one's", async () => {
    const subscriber = await pastDue();

    const later = { invoiceId: "in_later", since: atDay(5) };
    subscriber.stripeSubscriptions.stripeChanges("sub_1", { pastDue: later });
    await subscriber.reconcile(atDay(8));

    expect(subscriber.stripeSubscriptions.cancelSubscription).not.toHaveBeenCalled();
    await subscriber.expectAdmitted();
    expect(subscriber.stripeSubscriptions.recorded.get("sub_1")?.pastDue).toEqual(later);

    await subscriber.reconcile(atDay(12));
    await subscriber.expectNotAdmitted();
  });

  it("records an alertable failure when Stripe refuses the cancellation, and the next pass closes it", async () => {
    const subscriber = await pastDue();
    subscriber.stripeSubscriptions.cancelSubscription.mockRejectedValueOnce(
      new Error("Stripe is unavailable"),
    );

    expect(await subscriber.reconcile(WINDOW_CLOSES)).toMatchObject({ failed: 1 });
    expect(subscriber.logger.error).toHaveBeenCalledWith("stripe_reconciliation.failed", {
      stage: "dunning",
      stripeSubscriptionId: "sub_1",
      invoiceId: "in_renewal",
      userId: user.id,
      error: "Stripe is unavailable",
    });
    await subscriber.expectAdmitted();

    await subscriber.reconcile(atDay(7.01));
    await subscriber.expectNotAdmitted();
  });
});

describe("self-hosted deployments", () => {
  it("run none of the reconciliation, even with a paid first invoice in Stripe", async () => {
    const subscriber = await signedUp({ policy: { mode: "self-hosted" } as AdmissionPolicy });

    const result = await subscriber.reconcile();

    expect(result).toEqual({ status: "skipped" });
    expect(subscriber.stripe.invoices.list).not.toHaveBeenCalled();
    expect(subscriber.stripe.events.list).not.toHaveBeenCalled();
    expect(subscriber.grantPaidAccess).not.toHaveBeenCalled();
  });
});
