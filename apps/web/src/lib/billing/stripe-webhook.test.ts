import { type AdmissionPolicy, lapsedRetentionDeadline } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { admitFromFirstPaidInvoice } from "./paid-access-admission";
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
  const { subscriptions, retrieveSubscription, recorded, confirmCancellation, stripeChanges } =
    createStripeSubscriptionsFake(harness.queries, { stripeCustomerId: CUSTOMER });
  const announceAdmission = vi.fn(async (_input: { userId: string; invoiceId: string }) => {
    // The email may only follow a recorded admission.
    const profile = await harness.queries.getAccessProfile({ userId: user.id });
    if (profile?.status !== "granted") throw new Error("announced before admission");
  });
  const deps: StripeWebhookDependencies = {
    policy,
    webhookSecret: SECRET,
    findAccountByStripeCustomer: async (id) => customers.get(id) ?? null,
    grantPaidAccess: (userId, stripeSubscriptionId) =>
      harness.queries.grantAccess({ userId, source: "paid_access", stripeSubscriptionId }),
    anchorUsagePeriod: async (userId, startedAt) => anchors.set(userId, startedAt),
    announceAdmission,
    retrieveSubscription,
    subscriptions,
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
    confirmCancellation,
    recorded,
    stripeChanges,
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
    confirmCancellation: vi.fn(),
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
      announceAdmission,
      retrieveSubscription: async () => ({
        id: "sub_1",
        stripeCustomerId: CUSTOMER,
        cancelAt: null,
        endedAt: null,
        pastDue: null,
      }),
      subscriptions: inertSubscriptions(),
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
      announceAdmission: vi.fn(),
      retrieveSubscription: vi.fn(),
      subscriptions: inertSubscriptions(),
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
