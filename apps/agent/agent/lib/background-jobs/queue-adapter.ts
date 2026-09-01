import {
  attachBackgroundJobQueueSignature,
  type BackgroundJobQueueSendAdapter,
  resolveBackgroundJobQueueSecret,
} from "@tendnote/db/queries/background-job-deliveries";
import { send as sendVercelQueueMessage } from "@vercel/queue";

/**
 * Eve's concrete Vercel queue transport. The outbox-publish orchestration is shared
 * in @tendnote/db (queue injected); only this thin adapter, which imports
 * `@vercel/queue`, stays app-side. Mirrors the web adapter so the data layer never
 * imports the queue provider (ADR-0068).
 *
 * Eve enqueues extraction/embedding work that the web deployment's consumer routes
 * process, so it signs every published payload with the same shared secret the web
 * consumer verifies (`@vercel/queue` authenticates nothing inbound). The secret MUST be
 * identical here and in the web deployment, or Eve's jobs will fail verification there.
 */
export function createVercelBackgroundJobQueueAdapter(): BackgroundJobQueueSendAdapter {
  return {
    async send(input) {
      const secret = resolveBackgroundJobQueueSecret(process.env);
      if (!secret) {
        // Fail closed off local dev: a production/preview publish without the secret
        // would be rejected by the consumer, so surface it as a publish failure.
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            "Background job queue signing secret is not configured; cannot publish signed delivery.",
          );
        }
        return sendVercelQueueMessage(input.topic, input.payload, {
          idempotencyKey: input.idempotencyKey,
          headers: input.headers,
        });
      }
      return sendVercelQueueMessage(
        input.topic,
        attachBackgroundJobQueueSignature(input.payload, secret),
        {
          idempotencyKey: input.idempotencyKey,
          headers: input.headers,
        },
      );
    },
  };
}
