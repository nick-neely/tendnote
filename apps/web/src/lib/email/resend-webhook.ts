import { Resend } from "resend";

/**
 * Checks a Resend webhook delivery's Svix signature and parses the event,
 * throwing on a forged or stale one. Kept here so the provider's SDK stays
 * inside the email module.
 */
export function verifyResendWebhook(input: {
  payload: string;
  headers: Headers;
  webhookSecret: string;
}): { type: string; data?: unknown } {
  // The SDK's verify reads only the signing secret, but its client refuses to
  // construct without a key, so a placeholder stands in. It is never sent.
  return new Resend("re_verify_only").webhooks.verify({
    payload: input.payload,
    headers: {
      id: input.headers.get("svix-id") ?? "",
      timestamp: input.headers.get("svix-timestamp") ?? "",
      signature: input.headers.get("svix-signature") ?? "",
    },
    webhookSecret: input.webhookSecret,
  });
}
