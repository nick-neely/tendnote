import type { BackgroundJobQueueSendAdapter } from "@tendnote/db/queries/background-job-deliveries";
import { send as sendVercelQueueMessage } from "@vercel/queue";

/**
 * Eve's concrete Vercel queue transport. The outbox-publish orchestration is shared
 * in @tendnote/db (queue injected); only this thin adapter, which imports
 * `@vercel/queue`, stays app-side. Mirrors the web adapter so the data layer never
 * imports the queue provider (ADR-0068).
 */
export function createVercelBackgroundJobQueueAdapter(): BackgroundJobQueueSendAdapter {
  return {
    async send(input) {
      return sendVercelQueueMessage(input.topic, input.payload, {
        idempotencyKey: input.idempotencyKey,
        headers: input.headers,
      });
    },
  };
}
