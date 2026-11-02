import {
  attachBackgroundJobQueueSignature,
  type BackgroundJobQueueSendAdapter,
  backgroundJobQueueSendOptions,
  resolveBackgroundJobQueueSecret,
} from "@tendnote/db/queries/background-job-deliveries";
import { send as sendVercelQueueMessage } from "@vercel/queue";

// The web deployment's signed Vercel Queue transport, kept apart from the
// consumer runtime so startup can register it (see `instrumentation.ts`)
// without loading the callback, rate-limit and hold machinery.

/**
 * Whether this process runs as a production or preview deployment. `NODE_ENV` is
 * `"production"` for both Vercel production and preview builds and only differs for
 * local development, which is exactly the boundary we want for the fail-closed rule.
 */
export function isProductionLikeDeployment(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The shared secret used to sign and verify background-job queue callbacks, or
 * `undefined` when none is configured. See {@link resolveBackgroundJobQueueSecret}.
 */
export function queueCallbackSecret(): string | undefined {
  return resolveBackgroundJobQueueSecret(process.env);
}

export function createVercelBackgroundJobQueueAdapter(): BackgroundJobQueueSendAdapter {
  return {
    async send(input) {
      const secret = queueCallbackSecret();
      if (!secret) {
        // Fail closed: a production/preview deploy without the secret cannot publish a
        // message the consumer would accept, so surface it as a publish failure (the
        // outbox retries) rather than enqueuing work that will be rejected on delivery.
        if (isProductionLikeDeployment()) {
          throw new Error(
            "Background job queue signing secret is not configured; cannot publish signed delivery.",
          );
        }
        // Local development: publish unsigned; the consumer's dev allowance skips
        // verification symmetrically.
        return sendVercelQueueMessage(
          input.topic,
          input.payload,
          backgroundJobQueueSendOptions(input),
        );
      }
      return sendVercelQueueMessage(
        input.topic,
        attachBackgroundJobQueueSignature(input.payload, secret),
        backgroundJobQueueSendOptions(input),
      );
    },
  };
}
