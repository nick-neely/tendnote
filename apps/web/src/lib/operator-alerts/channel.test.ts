import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionalEmail } from "@/lib/email/transactional";
import { createOperatorAlertSender, operatorAlertDestinations } from "./channel";

const MESSAGE = {
  title: "Spend Breaker tripped",
  body: "Look at the logs.",
  urgent: true,
  key: "k1",
};

function harness(options: { emailFails?: boolean; pushStatus?: number } = {}) {
  const emails: TransactionalEmail[] = [];
  const pushes: { url: string; init: RequestInit }[] = [];
  const sendEmail = vi.fn(async (email: TransactionalEmail) => {
    if (options.emailFails) throw new Error("email down");
    emails.push(email);
    return { providerMessageId: null };
  });
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    pushes.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: options.pushStatus ?? 200 });
  });
  return { emails, pushes, sendEmail, fetch: fetchStub as unknown as typeof fetch };
}

describe("operatorAlertDestinations", () => {
  it("is off when neither destination is configured", () => {
    expect(operatorAlertDestinations({})).toBeNull();
    expect(operatorAlertDestinations({ TENDNOTE_OPERATOR_ALERT_EMAIL: " " })).toBeNull();
  });

  it("reads email and push separately", () => {
    expect(
      operatorAlertDestinations({
        TENDNOTE_OPERATOR_ALERT_EMAIL: "operator@example.test",
        TENDNOTE_OPERATOR_ALERT_PUSH_URL: "https://ntfy.example.test/topic",
        TENDNOTE_OPERATOR_ALERT_PUSH_TOKEN: "tk_1",
      }),
    ).toEqual({
      email: "operator@example.test",
      push: { url: "https://ntfy.example.test/topic", token: "tk_1" },
    });
    expect(
      operatorAlertDestinations({ TENDNOTE_OPERATOR_ALERT_PUSH_URL: "https://n.test/t" }),
    ).toEqual({ email: null, push: { url: "https://n.test/t", token: null } });
  });
});

describe("createOperatorAlertSender", () => {
  const destinations = {
    email: "operator@example.test",
    push: { url: "https://ntfy.example.test/topic", token: "tk_1" },
  };

  it("sends one message as an email and a phone push", async () => {
    const h = harness();

    await createOperatorAlertSender({ destinations, sendEmail: h.sendEmail, fetch: h.fetch })(
      MESSAGE,
    );

    expect(h.emails).toEqual([
      expect.objectContaining({
        to: "operator@example.test",
        subject: "[Tendnote] Spend Breaker tripped",
        text: "Look at the logs.",
        idempotencyKey: "k1",
      }),
    ]);
    expect(h.pushes).toEqual([
      {
        url: "https://ntfy.example.test/topic",
        init: expect.objectContaining({
          method: "POST",
          body: "Look at the logs.",
          headers: {
            Title: "Spend Breaker tripped",
            Priority: "high",
            Authorization: "Bearer tk_1",
          },
        }),
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts a message delivered when one destination took it, and logs the other", async () => {
    const h = harness({ emailFails: true });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await createOperatorAlertSender({ destinations, sendEmail: h.sendEmail, fetch: h.fetch })(
      MESSAGE,
    );

    expect(h.pushes).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("operator_alert.destination_failed", {
      destination: "email",
      reason: "Error",
    });
  });

  it("throws for a retry only when every destination failed", async () => {
    const h = harness({ emailFails: true, pushStatus: 403 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createOperatorAlertSender({ destinations, sendEmail: h.sendEmail, fetch: h.fetch })(MESSAGE),
    ).rejects.toThrow("email down");
  });

  it("throws when the only destination refused the push", async () => {
    const h = harness({ pushStatus: 403 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createOperatorAlertSender({
        destinations: { email: null, push: destinations.push },
        fetch: h.fetch,
      })(MESSAGE),
    ).rejects.toThrow(/403/);
  });

  it("sends only to the destinations configured", async () => {
    const h = harness();

    await createOperatorAlertSender({
      destinations: { email: null, push: { url: "https://n.test/t", token: null } },
      sendEmail: h.sendEmail,
      fetch: h.fetch,
    })({ ...MESSAGE, urgent: false });

    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.pushes[0]?.init.headers).toEqual({
      Title: "Spend Breaker tripped",
      Priority: "default",
    });
  });
});
