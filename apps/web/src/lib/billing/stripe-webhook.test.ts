import { type AdmissionPolicy, lapsedRetentionDeadline } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { admitFromFirstPaidInvoice } from "./paid-access-admission";
import { createPaidAccessRevocationsFake } from "./paid-access-revocations-fake";
import { createStripeSubscriptionsFake } from "./stripe-subscriptions-fake";
import { createStripeWebhookHandler, type StripeWebhookDependencies } from "./stripe-webhook";

const SECRET = "whsec_test_secret";
const user = { id: "subscriber-1", email: "subscriber@example.com" };
const CUSTOMER = "cus_subscriber";
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };
/** 2026-03-15T17:04:05Z, when the fixture subscription started. */
const SUBSCRIPTION_STARTED = 1773594245;
/** The end of the fixture subscription's first monthly period. */
const PERIOD_END = new Date("2026-04-15T17:04:05.000Z");

let eventSequence = 0;

function stripeEvent(type: string, object: Record<string, unknown>) {
  eventSequence += 1;
  return { id: `evt_${eventSequence}`, object: "event", type, data: { object } };
}

function invoice(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "in_first",
    object: "invoice",
    customer: CUSTOMER,
    status,
    billing_reason: "subscription_create",
    period_start: SUBSCRIPTION_STARTED,
    period_end: SUBSCRIPTION_STARTED,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_1", metadata: {} },
    },
    ...overrides,
  };
}

const invoicePaid = (overrides?: Record<string, unknown>) =>
  stripeEvent("invoice.paid", invoice("paid", overrides));

async function signedDelivery(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return new Request("https://app.tendnote.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

/**
 * The web and Eve halves of admission over one Access Profile store, with the
 * webhook receiver writing into that same store the way production wires it.
 */
function subscriberHarness(policy: AdmissionPolicy = hosted) {
  const harness = createAdmissionHarness({
    policy,
    evaluateFlag: vi.fn().mockResolvedValue(false),
    user,
  });
  const customers = new Map([[CUSTOMER, user.id]]);
  const anchors = new Map<string, Date>();
  const log = vi.fn();
  const stripeSubscriptions = createStripeSubscriptionsFake(harness.queries, {
    stripeCustomerId: CUSTOMER,
  });
  const { subscriptions, retrieveSubscription, recorded, confirmCancellation, stripeChanges } =
    stripeSubscriptions;
  const revocations = createPaidAccessRevocationsFake();
  const confirmRefund = vi.fn(async (_input: { userId: string; refundRecordId: string }) => {});
  // The subscription each payment paid for, as Stripe's invoice payments say.
  const payments = new Map([
    ["pi_first", { stripeSubscriptionId: "sub_1", stripeCustomerId: CUSTOMER }],
  ]);
  const announceAdmission = vi.fn(async (_input: { userId: string; invoiceId: string }) => {
    // The email may only follow a recorded admission.
    const profile = await harness.queries.getAccessProfile({ userId: user.id });
    if (profile?.status !== "granted") throw new Error("announced before admission");
  });
  const remindOfRenewal = vi.fn(
    async (_input: { userId: string; stripeSubscriptionId: string; renewsAt: Date }) => {},
  );
  const recordFunnelStage = vi.fn(async (_userId: string, _stage: string) => {});
  const deps: StripeWebhookDependencies = {
    policy,
    webhookSecret: SECRET,
    findAccountByStripeCustomer: async (id) => customers.get(id) ?? null,
    grantPaidAccess: (userId, stripeSubscriptionId) =>
      harness.queries.grantAccess({ userId, source: "paid_access", stripeSubscriptionId }),
    anchorUsagePeriod: async (userId, startedAt) => anchors.set(userId, startedAt),
    recordFunnelStage,
    announceAdmission,
    remindOfRenewal,
    retrieveSubscription,
    subscriptions,
    revocations: revocations.revocations,
    cancelSubscription: stripeSubscriptions.cancelSubscription,
    stopRenewal: stripeSubscriptions.stopRenewal,
    resolvePaymentSubscription: async (paymentIntentId) => payments.get(paymentIntentId) ?? null,
    confirmRefund,
    log,
  };
  const receive = createStripeWebhookHandler(deps);

  async function deliver(event: object) {
    return receive(await signedDelivery(event));
  }

  async function expectAdmitted() {
    await expect(
      harness.web.resolveAccess({ userId: user.id, email: user.email }),
    ).resolves.toMatchObject({ admitted: true, profile: { source: "paid_access" } });
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
    deps,
    receive,
    deliver,
    log,
    anchors,
    announceAdmission,
    remindOfRenewal,
    recordFunnelStage,
    confirmCancellation,
    confirmRefund,
    recorded,
    stripeChanges,
    stripeSubscriptions,
    revocations,
    expectAdmitted,
    expectNotAdmitted,
  };
}

/** A projection store for handlers whose test never reaches a subscription. */
function inertSubscriptions(): StripeWebhookDependencies["subscriptions"] {
  return {
    getSubscription: async () => null,
    recordSubscription: vi.fn(),
    lapsePaidAccess: vi.fn(),
    paysForAccount: vi.fn(),
    confirmCancellation: vi.fn(),
  };
}

/** Revocation dependencies for handlers whose test never sees a refund or dispute. */
function inertRevocations() {
  return {
    revocations: createPaidAccessRevocationsFake().revocations,
    cancelSubscription: vi.fn(),
    stopRenewal: vi.fn(),
    resolvePaymentSubscription: vi.fn(),
    confirmRefund: vi.fn(),
  };
}

const subscriptionEvent = (type: "updated" | "deleted", id = "sub_1") =>
  stripeEvent(`customer.subscription.${type}`, {
    id,
    object: "subscription",
    customer: CUSTOMER,
    // Deliberately stale: the receiver re-reads Stripe's current copy.
    status: "active",
  });

async function signedUp(policy?: AdmissionPolicy) {
  const harness = subscriberHarness(policy);
  await harness.queries.ensureAccessProfile({ userId: user.id });
  return harness;
}

describe("Paid Access from the first paid invoice", () => {
  it("admits the account on web and Eve when its first invoice is paid", async () => {
    const subscriber = await signedUp();
    await subscriber.expectNotAdmitted();

    const response = await subscriber.deliver(invoicePaid());

    expect(response.status).toBe(200);
    await subscriber.expectAdmitted();
  });

  it("copies payment and admission into the account funnel from server state", async () => {
    const subscriber = await signedUp();

    await subscriber.deliver(invoicePaid());

    expect(subscriber.recordFunnelStage.mock.calls).toEqual([
      [user.id, "payment_confirmed"],
      [user.id, "paid_access_granted"],
    ]);
  });

  it("confirms the payment but records no admission for a subscription that has ended", async () => {
    const subscriber = await signedUp();
    subscriber.stripeChanges("sub_1", { endedAt: PERIOD_END });

    await subscriber.deliver(invoicePaid());

    await subscriber.expectNotAdmitted();
    expect(subscriber.recordFunnelStage.mock.calls).toEqual([[user.id, "payment_confirmed"]]);
  });

  it("sends the 'you're in' email once admission is recorded, keyed on the invoice", async () => {
    const subscriber = await signedUp();

    await subscriber.deliver(invoicePaid());

    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
    expect(subscriber.announceAdmission).toHaveBeenCalledWith({
      userId: user.id,
      invoiceId: "in_first",
    });
    await expect(subscriber.announceAdmission.mock.results[0]?.value).resolves.toBeUndefined();
  });

  it("asks Stripe to redeliver when the email fails, keeping the admission", async () => {
    const subscriber = await signedUp();
    subscriber.announceAdmission.mockRejectedValueOnce(new Error("email provider down"));

    await expect(subscriber.deliver(invoicePaid())).rejects.toThrow(/provider down/);
    await subscriber.expectAdmitted();
  });

  it("does not admit on a completed checkout, a created customer, or an active subscription whose invoice is unpaid", async () => {
    const subscriber = await signedUp();

    for (const event of [
      stripeEvent("checkout.session.completed", {
        id: "cs_1",
        object: "checkout.session",
        client_reference_id: user.id,
        customer: CUSTOMER,
        payment_status: "unpaid",
      }),
      stripeEvent("customer.created", { id: CUSTOMER, object: "customer" }),
      stripeEvent("customer.subscription.created", {
        id: "sub_1",
        object: "subscription",
        customer: CUSTOMER,
        status: "active",
      }),
      stripeEvent("invoice.finalized", invoice("open")),
      stripeEvent("invoice.payment_failed", invoice("open")),
    ]) {
      expect((await subscriber.deliver(event)).status).toBe(200);
    }

    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
    expect(subscriber.recordFunnelStage).not.toHaveBeenCalled();
  });

  it("sends no email for an abandoned or expired checkout", async () => {
    const subscriber = await signedUp();

    for (const event of [
      stripeEvent("checkout.session.expired", {
        id: "cs_1",
        object: "checkout.session",
        client_reference_id: user.id,
        customer: CUSTOMER,
        status: "expired",
        payment_status: "unpaid",
      }),
      stripeEvent("invoice.voided", invoice("void")),
    ]) {
      expect((await subscriber.deliver(event)).status).toBe(200);
    }

    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
  });

  it("does not treat a paid renewal as the first paid invoice", async () => {
    const subscriber = await signedUp();

    await subscriber.deliver(invoicePaid({ billing_reason: "subscription_cycle" }));

    await subscriber.expectNotAdmitted();
    expect(subscriber.anchors.size).toBe(0);
  });

  it("anchors the Usage Period to the day the subscription started", async () => {
    const subscriber = await signedUp();

    await subscriber.deliver(invoicePaid());

    expect(subscriber.anchors.get(user.id)?.toISOString()).toBe("2026-03-15T17:04:05.000Z");
  });

  it("keeps the anchor through renewals, monthly or annual, and re-anchors a new subscription", async () => {
    const subscriber = await signedUp();
    await subscriber.deliver(invoicePaid());

    const renewal = SUBSCRIPTION_STARTED + 365 * 86_400 + 9 * 86_400;
    await subscriber.deliver(
      invoicePaid({ billing_reason: "subscription_cycle", period_start: renewal }),
    );
    expect(subscriber.anchors.get(user.id)?.toISOString()).toBe("2026-03-15T17:04:05.000Z");

    const resubscribed = SUBSCRIPTION_STARTED + 200 * 86_400;
    await subscriber.deliver(invoicePaid({ id: "in_again", period_start: resubscribed }));
    expect(subscriber.anchors.get(user.id)?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("does not treat a paid invoice outside a subscription as admission", async () => {
    const subscriber = await signedUp();

    await subscriber.deliver(invoicePaid({ parent: null }));

    await subscriber.expectNotAdmitted();
  });

  it("is safe under duplicate and reordered deliveries", async () => {
    const subscriber = await signedUp();
    const paid = invoicePaid();
    const completed = stripeEvent("checkout.session.completed", {
      id: "cs_1",
      object: "checkout.session",
      client_reference_id: user.id,
      customer: CUSTOMER,
      payment_status: "paid",
    });

    // The paid invoice arrives before the session it came from, then twice more.
    for (const event of [paid, paid, completed, paid]) {
      expect((await subscriber.deliver(event)).status).toBe(200);
    }

    await subscriber.expectAdmitted();
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      status: "granted",
      source: "paid_access",
    });
    // Every redelivery names the same invoice, so the provider sends one message.
    const invoices = subscriber.announceAdmission.mock.calls.map(([input]) => input.invoiceId);
    expect(new Set(invoices)).toEqual(new Set(["in_first"]));
  });

  it("admits nobody for a customer Tendnote never created, and says so", async () => {
    const subscriber = await signedUp();

    const response = await subscriber.deliver(invoicePaid({ customer: "cus_unknown" }));

    expect(response.status).toBe(200);
    expect(subscriber.log).toHaveBeenCalledWith(expect.stringMatching(/unknown customer/));
    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
  });

  it("asks Stripe to redeliver when recording Paid Access fails, sending nothing", async () => {
    const announceAdmission = vi.fn();
    const receive = createStripeWebhookHandler({
      policy: hosted,
      webhookSecret: SECRET,
      findAccountByStripeCustomer: async () => user.id,
      grantPaidAccess: async () => {
        throw new Error("database unavailable");
      },
      anchorUsagePeriod: vi.fn(),
      recordFunnelStage: vi.fn(),
      announceAdmission,
      remindOfRenewal: vi.fn(),
      retrieveSubscription: async () => ({
        id: "sub_1",
        stripeCustomerId: CUSTOMER,
        cancelAt: null,
        endedAt: null,
        pastDue: null,
      }),
      subscriptions: inertSubscriptions(),
      ...inertRevocations(),
    });

    await expect(receive(await signedDelivery(invoicePaid()))).rejects.toThrow(/unavailable/);
    expect(announceAdmission).not.toHaveBeenCalled();
  });
});

describe("Stripe webhook signature", () => {
  it("rejects an unsigned delivery before reading the event", async () => {
    const subscriber = await signedUp();

    const response = await subscriber.receive(
      new Request("https://app.tendnote.test/api/stripe/webhook", {
        method: "POST",
        body: JSON.stringify(invoicePaid()),
      }),
    );

    expect(response.status).toBe(400);
    await subscriber.expectNotAdmitted();
  });

  it("rejects a delivery signed with another secret", async () => {
    const subscriber = await signedUp();

    const response = await subscriber.receive(
      await signedDelivery(invoicePaid(), "whsec_someone_else"),
    );

    expect(response.status).toBe(400);
    await subscriber.expectNotAdmitted();
  });

  it("rejects a delivery whose body was altered after signing", async () => {
    const subscriber = await signedUp();
    const signed = await signedDelivery(stripeEvent("invoice.payment_failed", invoice("open")));
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(invoicePaid()),
    });

    expect((await subscriber.receive(tampered)).status).toBe(400);
    await subscriber.expectNotAdmitted();
  });

  it("refuses every delivery when no signing secret is configured", async () => {
    const grantPaidAccess = vi.fn();
    const receive = createStripeWebhookHandler({
      policy: hosted,
      webhookSecret: undefined,
      findAccountByStripeCustomer: async () => user.id,
      grantPaidAccess,
      anchorUsagePeriod: vi.fn(),
      recordFunnelStage: vi.fn(),
      announceAdmission: vi.fn(),
      remindOfRenewal: vi.fn(),
      retrieveSubscription: vi.fn(),
      subscriptions: inertSubscriptions(),
      ...inertRevocations(),
    });

    expect((await receive(await signedDelivery(invoicePaid()))).status).toBe(503);
    expect(grantPaidAccess).not.toHaveBeenCalled();
  });
});

describe("cancellation through the portal ends in a Lapsed Account (#609)", () => {
  async function paying() {
    const subscriber = await signedUp();
    await subscriber.deliver(invoicePaid());
    await subscriber.expectAdmitted();
    return subscriber;
  }

  async function profile(subscriber: Awaited<ReturnType<typeof signedUp>>) {
    return subscriber.queries.getAccessProfile({ userId: user.id });
  }

  it("keeps a scheduled cancellation admitted, records when it ends, and confirms it by email", async () => {
    const subscriber = await paying();

    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END });
    expect((await subscriber.deliver(subscriptionEvent("updated"))).status).toBe(200);

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_1")).toMatchObject({ cancelAt: PERIOD_END, endedAt: null });
    expect(subscriber.confirmCancellation).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      stripeSubscriptionId: "sub_1",
      endsAt: PERIOD_END,
    });
  });

  it("confirms one cancellation once, however often it is delivered", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END });

    await subscriber.deliver(subscriptionEvent("updated"));
    await subscriber.deliver(subscriptionEvent("updated"));

    expect(subscriber.confirmCancellation).toHaveBeenCalledOnce();
  });

  it("asks Stripe to redeliver when the confirmation fails, recording nothing until it is sent", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END });
    subscriber.confirmCancellation.mockRejectedValueOnce(new Error("email provider down"));

    await expect(subscriber.deliver(subscriptionEvent("updated"))).rejects.toThrow(/provider down/);
    expect(subscriber.recorded.get("sub_1")?.cancelAt).toBeNull();

    await subscriber.deliver(subscriptionEvent("updated"));
    expect(subscriber.confirmCancellation).toHaveBeenCalledTimes(2);
    expect(subscriber.recorded.get("sub_1")?.cancelAt).toEqual(PERIOD_END);
  });

  it("returns to Paid when the cancellation is reversed", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("updated"));

    subscriber.stripeChanges("sub_1", { cancelAt: null });
    await subscriber.deliver(subscriptionEvent("updated"));

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_1")).toMatchObject({ cancelAt: null, endedAt: null });
    expect(subscriber.confirmCancellation).toHaveBeenCalledOnce();
  });

  it("makes the account Lapsed at period end, with the deadline from the retention constant", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("updated"));

    subscriber.stripeChanges("sub_1", { endedAt: PERIOD_END });
    expect((await subscriber.deliver(subscriptionEvent("deleted"))).status).toBe(200);

    await subscriber.expectNotAdmitted();
    await expect(profile(subscriber)).resolves.toMatchObject({
      status: "pending",
      retentionDeadline: lapsedRetentionDeadline(PERIOD_END),
    });
  });

  it("is safe when the end arrives before the cancellation that scheduled it, or twice", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END, endedAt: PERIOD_END });

    for (const event of [subscriptionEvent("deleted"), subscriptionEvent("updated")]) {
      await subscriber.deliver(event);
      await subscriber.deliver(event);
    }

    await subscriber.expectNotAdmitted();
    await expect(profile(subscriber)).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(PERIOD_END),
    });
    // An ended subscription has nothing left to confirm.
    expect(subscriber.confirmCancellation).not.toHaveBeenCalled();
  });

  it("never re-admits on a redelivered first invoice of the subscription that ended", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { endedAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("deleted"));

    expect((await subscriber.deliver(invoicePaid())).status).toBe(200);

    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
  });

  it("never re-admits when a revoked account's still-paid first invoice is re-projected, as reconciliation does", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { endedAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("deleted"));

    await expect(
      admitFromFirstPaidInvoice(subscriber.deps, user.id, {
        invoiceId: "in_first",
        stripeCustomerId: CUSTOMER,
        stripeSubscriptionId: "sub_1",
        startedAt: new Date(SUBSCRIPTION_STARTED * 1000),
      }),
    ).resolves.toBeNull();

    await subscriber.expectNotAdmitted();
    await expect(profile(subscriber)).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(PERIOD_END),
    });
  });

  it("restores Paid and clears the deadline on resubscribing, and a late end of the old one changes nothing", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { endedAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("deleted"));

    subscriber.stripeChanges("sub_2", {});
    await subscriber.deliver(
      invoicePaid({
        id: "in_again",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_2", metadata: {} },
        },
      }),
    );

    await subscriber.expectAdmitted();
    await expect(profile(subscriber)).resolves.toMatchObject({ retentionDeadline: null });

    await subscriber.deliver(subscriptionEvent("deleted"));
    await subscriber.expectAdmitted();
  });

  it("does not end or decorate the account when the interval changes", async () => {
    const subscriber = await paying();

    // Monthly to annual applies at once and invoices the difference; annual to
    // monthly is scheduled for the end of the paid year. Neither cancels.
    await subscriber.deliver(subscriptionEvent("updated"));
    await subscriber.deliver(
      invoicePaid({ id: "in_upgrade", billing_reason: "subscription_update" }),
    );

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_1")).toMatchObject({ cancelAt: null, endedAt: null });
    expect(subscriber.confirmCancellation).not.toHaveBeenCalled();
    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
  });

  it("acknowledges a subscription of a customer Tendnote never created, and says so", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_other", { stripeCustomerId: "cus_unknown", endedAt: PERIOD_END });

    const response = await subscriber.deliver(subscriptionEvent("deleted", "sub_other"));

    expect(response.status).toBe(200);
    expect(subscriber.log).toHaveBeenCalledWith(expect.stringMatching(/unknown customer/));
    await subscriber.expectAdmitted();
  });
});

describe("renewal failure: Past Due while Stripe retries (#610)", () => {
  const renewal = { invoiceId: "in_renewal", since: PERIOD_END };
  const renewalInvoice = (status: string) =>
    invoice(status, { id: "in_renewal", billing_reason: "subscription_cycle" });

  async function pastDue() {
    const subscriber = await signedUp();
    await subscriber.deliver(invoicePaid());
    subscriber.stripeChanges("sub_1", { pastDue: renewal });
    await subscriber.deliver(stripeEvent("invoice.payment_failed", renewalInvoice("open")));
    await subscriber.deliver(subscriptionEvent("updated"));
    return subscriber;
  }

  it("keeps the account admitted on web and Eve, recording the failed renewal for its notice", async () => {
    const subscriber = await pastDue();

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_1")).toMatchObject({ pastDue: renewal, endedAt: null });
  });

  it("returns to Paid when the payment recovers, clearing the notice", async () => {
    const subscriber = await pastDue();

    subscriber.stripeChanges("sub_1", { pastDue: null });
    await subscriber.deliver(stripeEvent("invoice.paid", renewalInvoice("paid")));
    await subscriber.deliver(subscriptionEvent("updated"));

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_1")?.pastDue).toBeNull();
    // A recovered renewal is not a first paid invoice.
    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
  });

  it("is safe under duplicate and reordered deliveries of the failure and the recovery", async () => {
    const subscriber = await pastDue();
    subscriber.stripeChanges("sub_1", { pastDue: null });

    // The failure's event lands after the recovery; Stripe's current copy wins.
    await subscriber.deliver(subscriptionEvent("updated"));
    await subscriber.deliver(subscriptionEvent("updated"));

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_1")?.pastDue).toBeNull();
  });
});

describe("the annual renewal reminder (#611)", () => {
  /** A year after the fixture subscription started, when an annual one renews. */
  const RENEWS_AT = new Date("2027-03-15T17:04:05.000Z");
  const unix = (date: Date) => date.getTime() / 1000;
  const ANNUAL = { start: unix(RENEWS_AT), end: unix(new Date("2028-03-15T17:04:05.000Z")) };
  const MONTHLY = { start: unix(RENEWS_AT), end: unix(new Date("2027-04-15T17:04:05.000Z")) };

  /** Stripe's preview of the renewal invoice, which has no id until it is created. */
  const upcomingRenewal = (period: { start: number; end: number }, subscription = "sub_1") =>
    stripeEvent("invoice.upcoming", {
      object: "invoice",
      customer: CUSTOMER,
      status: "draft",
      billing_reason: "upcoming",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription, metadata: {} },
      },
      lines: { data: [{ parent: { type: "subscription_item_details" }, period }] },
    });

  async function subscribed() {
    const subscriber = await signedUp();
    await subscriber.deliver(invoicePaid());
    return subscriber;
  }

  it("reminds an annual subscriber before the renewal, keyed on it", async () => {
    const subscriber = await subscribed();

    expect((await subscriber.deliver(upcomingRenewal(ANNUAL))).status).toBe(200);

    expect(subscriber.remindOfRenewal).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      stripeSubscriptionId: "sub_1",
      renewsAt: RENEWS_AT,
    });
    await subscriber.expectAdmitted();
  });

  it("does not remind a monthly subscriber", async () => {
    const subscriber = await subscribed();

    expect((await subscriber.deliver(upcomingRenewal(MONTHLY))).status).toBe(200);

    expect(subscriber.remindOfRenewal).not.toHaveBeenCalled();
  });

  it("does not remind a subscriber whose subscription ends at the renewal instead", async () => {
    const subscriber = await subscribed();
    subscriber.stripeChanges("sub_1", { cancelAt: RENEWS_AT });

    await subscriber.deliver(upcomingRenewal(ANNUAL));

    expect(subscriber.remindOfRenewal).not.toHaveBeenCalled();
  });

  it("still reminds a subscriber whose cancellation takes effect after this renewal", async () => {
    const subscriber = await subscribed();
    subscriber.stripeChanges("sub_1", { cancelAt: new Date("2027-09-15T17:04:05.000Z") });

    await subscriber.deliver(upcomingRenewal(ANNUAL));

    expect(subscriber.remindOfRenewal).toHaveBeenCalledOnce();
  });

  it("asks Stripe to redeliver when the reminder fails", async () => {
    const subscriber = await subscribed();
    subscriber.remindOfRenewal.mockRejectedValueOnce(new Error("email provider down"));

    await expect(subscriber.deliver(upcomingRenewal(ANNUAL))).rejects.toThrow(/provider down/);
    await subscriber.deliver(upcomingRenewal(ANNUAL));

    expect(subscriber.remindOfRenewal).toHaveBeenCalledTimes(2);
  });

  it("acknowledges the renewal of a customer Tendnote never created, and says so", async () => {
    const subscriber = await subscribed();
    const event = upcomingRenewal(ANNUAL, "sub_other");
    (event.data.object as Record<string, unknown>).customer = "cus_unknown";

    expect((await subscriber.deliver(event)).status).toBe(200);

    expect(subscriber.remindOfRenewal).not.toHaveBeenCalled();
    expect(subscriber.log).toHaveBeenCalledWith(expect.stringMatching(/unknown customer/));
  });
});

describe("self-hosted deployments", () => {
  it("run none of the Stripe receiver, even for a correctly signed paid invoice", async () => {
    const subscriber = await signedUp({
      mode: "self-hosted",
      valid: true,
      bootstrapOwnerEmail: "owner@example.com",
    });

    const response = await subscriber.deliver(invoicePaid());

    expect(response.status).toBe(404);
    await expect(subscriber.queries.getAccessProfile({ userId: user.id })).resolves.toMatchObject({
      status: "pending",
      source: null,
    });
    expect(subscriber.announceAdmission).not.toHaveBeenCalled();
  });

  it("never admit through a Paid Access grant", async () => {
    const subscriber = subscriberHarness({
      mode: "self-hosted",
      valid: true,
      bootstrapOwnerEmail: "owner@example.com",
    });
    await subscriber.queries.grantAccess({ userId: user.id, source: "paid_access" });

    await subscriber.expectNotAdmitted();
  });
});

describe("refunds and disputes (#617)", () => {
  /** When the fixture refund was taken, inside the fourteen-day guarantee. */
  const REFUNDED_AT = new Date("2026-03-20T12:00:00.000Z");
  /** When the fixture dispute was opened. */
  const DISPUTED_AT = new Date("2026-03-25T08:00:00.000Z");

  const refundCreated = (overrides: Record<string, unknown> = {}) =>
    stripeEvent("refund.created", {
      id: "re_1",
      object: "refund",
      payment_intent: "pi_first",
      amount: 2000,
      created: REFUNDED_AT.getTime() / 1000,
      status: "succeeded",
      ...overrides,
    });

  const disputeCreated = (overrides: Record<string, unknown> = {}) =>
    stripeEvent("charge.dispute.created", {
      id: "du_1",
      object: "dispute",
      payment_intent: "pi_first",
      created: DISPUTED_AT.getTime() / 1000,
      status: "needs_response",
      ...overrides,
    });

  async function paying() {
    const subscriber = await signedUp();
    await subscriber.deliver(invoicePaid());
    await subscriber.expectAdmitted();
    return subscriber;
  }

  /** The Refund Operator Action's record, with the Stripe refund id stored unless `null`. */
  async function refundRecord(
    subscriber: Awaited<ReturnType<typeof signedUp>>,
    input: { subscription?: string; stripeRefundId?: string | null } = {},
  ) {
    const record = await subscriber.revocations.records.recordRefund({
      userId: user.id,
      stripeSubscriptionId: input.subscription ?? "sub_1",
      invoiceId: "in_first",
      paymentIntentId: "pi_first",
      amount: 2000,
      requestedAt: new Date(REFUNDED_AT.getTime() - 1000),
    });
    if (input.stripeRefundId !== null) {
      await subscriber.revocations.revocations.attachStripeRefund({
        id: record.id,
        stripeRefundId: input.stripeRefundId ?? "re_1",
      });
    }
    return record;
  }

  async function profile(subscriber: Awaited<ReturnType<typeof signedUp>>) {
    return subscriber.queries.getAccessProfile({ userId: user.id });
  }

  it("revokes at once on a refund matching its Refund record, ends the subscription, and confirms by email", async () => {
    const subscriber = await paying();
    const record = await refundRecord(subscriber);

    expect((await subscriber.deliver(refundCreated())).status).toBe(200);

    await subscriber.expectNotAdmitted();
    await expect(profile(subscriber)).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(REFUNDED_AT),
    });
    expect(subscriber.recorded.get("sub_1")?.endedAt).not.toBeNull();
    expect(subscriber.confirmCancellation).not.toHaveBeenCalled();
    expect(subscriber.confirmRefund).toHaveBeenCalledExactlyOnceWith({
      userId: user.id,
      refundRecordId: record.id,
    });
  });

  it("revokes and confirms one refund once, however often it is delivered", async () => {
    const subscriber = await paying();
    await refundRecord(subscriber);

    await subscriber.deliver(refundCreated());
    await subscriber.deliver(refundCreated());

    await subscriber.expectNotAdmitted();
    expect(subscriber.stripeSubscriptions.cancelSubscription).toHaveBeenCalledOnce();
    expect(subscriber.confirmRefund).toHaveBeenCalledOnce();
  });

  it("matches a refund whose id was never stored on payment, amount, and time, and stores it", async () => {
    const subscriber = await paying();
    const record = await refundRecord(subscriber, { stripeRefundId: null });

    await subscriber.deliver(refundCreated());

    await subscriber.expectNotAdmitted();
    expect(subscriber.revocations.refunds.find((each) => each.id === record.id)).toMatchObject({
      stripeRefundId: "re_1",
    });
  });

  it("changes nothing on a refund matching no Refund record, and raises the reconciliation alert", async () => {
    const subscriber = await paying();
    // Same payment, but a different amount: a dashboard refund nobody recorded.
    await refundRecord(subscriber, { stripeRefundId: null });

    const response = await subscriber.deliver(refundCreated({ amount: 500 }));

    expect(response.status).toBe(200);
    await subscriber.expectAdmitted();
    expect(subscriber.log).toHaveBeenCalledWith(
      expect.stringMatching(/stripe_reconciliation\.failed: refund re_1 matches no Refund record/),
    );
    expect(subscriber.stripeSubscriptions.cancelSubscription).not.toHaveBeenCalled();
    expect(subscriber.confirmRefund).not.toHaveBeenCalled();
  });

  it("revokes nothing for a refund that failed", async () => {
    const subscriber = await paying();
    await refundRecord(subscriber);

    await subscriber.deliver(refundCreated({ status: "failed" }));

    await subscriber.expectAdmitted();
    expect(subscriber.confirmRefund).not.toHaveBeenCalled();
  });

  it("leaves a fresh subscription admitted when an older one is refunded", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { endedAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("deleted"));
    subscriber.stripeChanges("sub_2", {});
    await subscriber.deliver(
      invoicePaid({
        id: "in_again",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_2", metadata: {} },
        },
      }),
    );
    await subscriber.expectAdmitted();

    await refundRecord(subscriber, { subscription: "sub_1" });
    await subscriber.deliver(refundCreated());

    await subscriber.expectAdmitted();
    expect(subscriber.recorded.get("sub_2")).toMatchObject({ endedAt: null, cancelAt: null });
  });

  it("never re-admits a refunded account from its still-paid first invoice", async () => {
    const subscriber = await paying();
    await refundRecord(subscriber);
    await subscriber.deliver(refundCreated());

    await subscriber.deliver(invoicePaid());

    await subscriber.expectNotAdmitted();
    expect(subscriber.announceAdmission).toHaveBeenCalledOnce();
  });

  it("revokes at once on a dispute and stops the renewal without confirming a cancellation", async () => {
    const subscriber = await paying();

    expect((await subscriber.deliver(disputeCreated())).status).toBe(200);

    await subscriber.expectNotAdmitted();
    await expect(profile(subscriber)).resolves.toMatchObject({
      retentionDeadline: lapsedRetentionDeadline(DISPUTED_AT),
    });
    // Stopped at the period end, not ended, so a won dispute can restore it.
    expect(subscriber.recorded.get("sub_1")).toMatchObject({ endedAt: null });
    expect(subscriber.recorded.get("sub_1")?.cancelAt).not.toBeNull();
    expect(subscriber.revocations.disputes.get("du_1")).toMatchObject({ renewalStopped: true });

    // Stripe's own notice of the stopped renewal is not the customer cancelling.
    await subscriber.deliver(subscriptionEvent("updated"));
    expect(subscriber.confirmCancellation).not.toHaveBeenCalled();
  });

  it("never re-admits a disputed account from its still-paid first invoice", async () => {
    const subscriber = await paying();
    await subscriber.deliver(disputeCreated());

    await subscriber.deliver(invoicePaid());

    await subscriber.expectNotAdmitted();
  });

  it("does not stop a renewal the customer already cancelled, so re-admission can never resume it", async () => {
    const subscriber = await paying();
    subscriber.stripeChanges("sub_1", { cancelAt: PERIOD_END });
    await subscriber.deliver(subscriptionEvent("updated"));

    await subscriber.deliver(disputeCreated());

    await subscriber.expectNotAdmitted();
    expect(subscriber.stripeSubscriptions.stopRenewal).not.toHaveBeenCalled();
    expect(subscriber.revocations.disputes.get("du_1")).toMatchObject({ renewalStopped: false });
  });

  it("changes nothing for a dispute on a payment outside any subscription, and says so", async () => {
    const subscriber = await paying();

    const response = await subscriber.deliver(disputeCreated({ payment_intent: "pi_elsewhere" }));

    expect(response.status).toBe(200);
    await subscriber.expectAdmitted();
    expect(subscriber.log).toHaveBeenCalledWith(expect.stringMatching(/disputes no Tendnote/));
  });
});
