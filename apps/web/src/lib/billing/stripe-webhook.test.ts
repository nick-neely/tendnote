import type { AdmissionPolicy } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createAdmissionHarness } from "../access/admission-harness";
import { createStripeWebhookHandler } from "./stripe-webhook";

const SECRET = "whsec_test_secret";
const user = { id: "subscriber-1", email: "subscriber@example.com" };
const CUSTOMER = "cus_subscriber";
const eveRequest = new Request("https://app.tendnote.test/eve/v1/session");
const hosted: AdmissionPolicy = { mode: "hosted", valid: true };

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
  const log = vi.fn();
  const receive = createStripeWebhookHandler({
    policy,
    webhookSecret: SECRET,
    findAccountByStripeCustomer: async (id) => customers.get(id) ?? null,
    grantPaidAccess: (userId) =>
      harness.queries.grantAccess({ userId, source: "paid_access" }),
    log,
  });

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

  return { ...harness, receive, deliver, log, expectAdmitted, expectNotAdmitted };
}

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
  });

  it("admits nobody for a customer Tendnote never created, and says so", async () => {
    const subscriber = await signedUp();

    const response = await subscriber.deliver(invoicePaid({ customer: "cus_unknown" }));

    expect(response.status).toBe(200);
    expect(subscriber.log).toHaveBeenCalledWith(expect.stringMatching(/unknown customer/));
    await subscriber.expectNotAdmitted();
  });

  it("asks Stripe to redeliver when recording Paid Access fails", async () => {
    const receive = createStripeWebhookHandler({
      policy: hosted,
      webhookSecret: SECRET,
      findAccountByStripeCustomer: async () => user.id,
      grantPaidAccess: async () => {
        throw new Error("database unavailable");
      },
    });

    await expect(receive(await signedDelivery(invoicePaid()))).rejects.toThrow(/unavailable/);
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
    });

    expect((await receive(await signedDelivery(invoicePaid()))).status).toBe(503);
    expect(grantPaidAccess).not.toHaveBeenCalled();
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
