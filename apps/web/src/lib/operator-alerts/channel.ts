import { selectTransactionalSender } from "@/lib/email/select-sender";
import type { TransactionalSender } from "@/lib/email/transactional";

/** Exactly the variables the channel reads. */
type OperatorAlertEnvironment = {
  TENDNOTE_OPERATOR_ALERT_EMAIL?: string;
  TENDNOTE_OPERATOR_ALERT_PUSH_URL?: string;
  TENDNOTE_OPERATOR_ALERT_PUSH_TOKEN?: string;
};

type OperatorAlertDestinations = {
  email: string | null;
  push: { url: string; token: string | null } | null;
};

/** One message on the channel: fixed text, and a key that names it for retries. */
export type OperatorAlertMessage = {
  title: string;
  body: string;
  /** An alert is urgent; a recovery notice or a new support email is not. */
  urgent: boolean;
  key: string;
};

const PUSH_TIMEOUT_MS = 10_000;

/**
 * Where alerts go: the operator's email, an ntfy topic for phone push, or
 * both (ADR 0258). `null` when neither is set, which turns the channel off; a
 * self-hosted deployment leaves both unset.
 */
export function operatorAlertDestinations(
  env: OperatorAlertEnvironment = process.env as OperatorAlertEnvironment,
): OperatorAlertDestinations | null {
  const email = env.TENDNOTE_OPERATOR_ALERT_EMAIL?.trim() || null;
  const url = env.TENDNOTE_OPERATOR_ALERT_PUSH_URL?.trim() || null;
  if (!email && !url) return null;
  const push = url ? { url, token: env.TENDNOTE_OPERATOR_ALERT_PUSH_TOKEN?.trim() || null } : null;
  return { email, push };
}

/**
 * Sends one message to every destination at once. The message counts as
 * delivered when any destination accepted it, so a destination that is down
 * for good is logged on each message rather than repeating the others' copies
 * forever. Only when every destination failed does it throw, for a retry.
 */
export function createOperatorAlertSender(input: {
  destinations: OperatorAlertDestinations;
  sendEmail?: TransactionalSender;
  fetch?: typeof fetch;
}) {
  const { email, push } = input.destinations;
  const sendEmail = email ? (input.sendEmail ?? selectTransactionalSender()) : null;
  const fetchImpl = input.fetch ?? fetch;

  return async (message: OperatorAlertMessage) => {
    const sends: { destination: "email" | "push"; sent: Promise<unknown> }[] = [];
    if (email && sendEmail) {
      sends.push({
        destination: "email",
        sent: sendEmail({
          to: email,
          subject: `[Tendnote] ${message.title}`,
          text: message.body,
          html: `<p>${escapeHtml(message.body)}</p>`,
          idempotencyKey: message.key,
        }),
      });
    }
    if (push) {
      sends.push({
        destination: "push",
        sent: fetchImpl(push.url, {
          method: "POST",
          body: message.body,
          headers: {
            Title: message.title,
            Priority: message.urgent ? "high" : "default",
            ...(push.token ? { Authorization: `Bearer ${push.token}` } : {}),
          },
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        }).then((response) => {
          if (!response.ok) throw new Error(`Push refused with status ${response.status}.`);
        }),
      });
    }

    const outcomes = await Promise.allSettled(sends.map(({ sent }) => sent));
    const failures = outcomes.flatMap((outcome, index) =>
      outcome.status === "rejected" ? [{ destination: sends[index]?.destination, outcome }] : [],
    );
    for (const { destination, outcome } of failures) {
      console.error("operator_alert.destination_failed", {
        destination,
        reason: outcome.reason instanceof Error ? outcome.reason.name : "unknown",
      });
    }
    if (failures.length === sends.length) throw failures[0]?.outcome.reason;
  };
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
