import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSupportEmailWebhookHandler } from "./support-email-webhook";

const SECRET = `whsec_${Buffer.from("operator-alert-test-secret").toString("base64")}`;

/** Signs as Resend's Svix deliveries are signed: HMAC-SHA256 over `id.timestamp.body`. */
function signedRequest(event: unknown, secret = SECRET) {
  const payload = JSON.stringify(event);
  const id = "msg_1";
  const timestamp = new Date();
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signed = `${id}.${Math.floor(timestamp.getTime() / 1000)}.${payload}`;
  const signature = `v1,${createHmac("sha256", key).update(signed).digest("base64")}`;
  return new Request("https://app.tendnote.test/api/resend/webhook", {
    method: "POST",
    body: payload,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
  });
}

const RECEIVED = {
  type: "email.received",
  created_at: "2026-10-03T12:00:00.000Z",
  data: {
    email_id: "email_1",
    from: "Customer <someone@example.test>",
    to: ["support@example.test"],
    subject: "Help with my account",
  },
};

function handler(notify = vi.fn(async () => {})) {
  return {
    notify,
    handle: createSupportEmailWebhookHandler({
      webhookSecret: SECRET,
      notifyNewSupportEmail: notify,
    }),
  };
}

describe("createSupportEmailWebhookHandler", () => {
  it("alerts on a new support email by its id alone", async () => {
    const { handle, notify } = handler();

    const response = await handle(signedRequest(RECEIVED));

    expect(response.status).toBe(200);
    expect(notify).toHaveBeenCalledExactlyOnceWith({ emailId: "email_1" });
  });

  it("refuses a delivery signed with another secret", async () => {
    const { handle, notify } = handler();
    const forged = `whsec_${Buffer.from("someone-else").toString("base64")}`;

    const response = await handle(signedRequest(RECEIVED, forged));

    expect(response.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses every delivery when no signing secret is configured", async () => {
    const notify = vi.fn(async () => {});
    const handle = createSupportEmailWebhookHandler({
      webhookSecret: undefined,
      notifyNewSupportEmail: notify,
    });

    const response = await handle(signedRequest(RECEIVED));

    expect(response.status).toBe(503);
    expect(notify).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores other event types", async () => {
    const { handle, notify } = handler();

    const response = await handle(signedRequest({ type: "email.delivered", data: {} }));

    expect(response.status).toBe(200);
    expect(notify).not.toHaveBeenCalled();
  });

  it("acknowledges a received event with no id rather than having it redelivered", async () => {
    const { handle, notify } = handler();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handle(signedRequest({ type: "email.received", data: {} }));

    expect(response.status).toBe(200);
    expect(notify).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("asks for redelivery when the alert could not be sent", async () => {
    const { handle } = handler(
      vi.fn(async () => {
        throw new Error("push down");
      }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handle(signedRequest(RECEIVED));

    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith("operator_alert.send_failed", {
      condition: "support_email",
      reason: "Error",
    });
    log.mockRestore();
  });
});
