import { verifyResendWebhook } from "@/lib/email/resend-webhook";

type SupportEmailWebhookDependencies = {
  /** The Resend endpoint's signing secret. Without it every delivery is refused. */
  webhookSecret: string | undefined;
  notifyNewSupportEmail: (input: { emailId: string }) => Promise<void>;
};

function receivedEmailId(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("email_id" in data)) return null;
  return typeof data.email_id === "string" && data.email_id ? data.email_id : null;
}

/**
 * The receiver for Resend's inbound mail events (#648). The support mailbox
 * receives through Resend, and each `email.received` event raises the "new
 * support email" alert. Only the provider's id for the message is read: the
 * alert carries no sender, subject, or body, and nothing about it is stored.
 * Every other event type is acknowledged and ignored.
 */
export function createSupportEmailWebhookHandler(deps: SupportEmailWebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    if (!deps.webhookSecret) {
      return new Response("Resend webhooks are not configured.", { status: 503 });
    }

    let event: ReturnType<typeof verifyResendWebhook>;
    try {
      event = verifyResendWebhook({
        payload: await request.text(),
        headers: request.headers,
        webhookSecret: deps.webhookSecret,
      });
    } catch {
      return new Response("Invalid Resend signature.", { status: 400 });
    }

    if (event.type !== "email.received") return new Response(null, { status: 200 });
    const emailId = receivedEmailId(event.data);
    if (!emailId) {
      // Signed but malformed: redelivery would carry the same payload, so it is
      // acknowledged and logged rather than retried for days.
      console.error("operator_alert.support_email_unreadable");
      return new Response(null, { status: 200 });
    }

    try {
      await deps.notifyNewSupportEmail({ emailId });
    } catch (error) {
      console.error("operator_alert.send_failed", {
        condition: "support_email",
        reason: error instanceof Error ? error.name : "unknown",
      });
      // Every destination failed. Resend redelivers, and email deduplicates on the id.
      return new Response("The alert could not be sent.", { status: 503 });
    }
    return new Response(null, { status: 200 });
  };
}
