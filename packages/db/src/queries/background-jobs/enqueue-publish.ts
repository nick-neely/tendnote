import { createDrizzleBackgroundJobDeliveryStore } from "../background-job-deliveries/drizzle-store";
import {
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  publishBackgroundJobDelivery,
} from "../background-job-deliveries/queue-publish";
import type { BackgroundJobDeliveryStore } from "../background-job-deliveries/types";
import type { BackgroundJobFamily, BackgroundJobRuntimeMode } from "./families";

export type EnqueueAndPublishBackgroundJobResult<TEnqueueResult> = TEnqueueResult & {
  deliveryId: string | null;
  publishResult: Awaited<ReturnType<typeof publishBackgroundJobDelivery>> | null;
};

/**
 * Shared enqueue-then-publish path for every Postgres-owned job family (ADR-0068). It
 * enqueues the durable job through the family's processor, and — only in `enqueue_only`
 * mode — records an outbox delivery intent and publishes the queue pointer through the
 * injected transport adapter. Inline mode returns without a delivery.
 *
 * The durable job (and any product mutation the enqueue performed) is committed before
 * publication is attempted, so a queue failure leaves an inspectable, recoverable
 * delivery row (`pending`/`publish_failed`) without reversing the capture. Web and Eve
 * both call this one function; only the concrete queue transport differs per runtime.
 */
export async function enqueueAndPublishBackgroundJob<
  TEnqueueInput,
  TEnqueueResult extends { job: { id: string } },
>(
  family: BackgroundJobFamily<TEnqueueInput, TEnqueueResult>,
  input: {
    ownerUserId: string;
    enqueueInput: TEnqueueInput;
    queue: BackgroundJobQueueSendAdapter;
    runtimeMode?: BackgroundJobRuntimeMode;
    deliveryStore?: BackgroundJobDeliveryStore;
    enqueue?: (
      input: TEnqueueInput & { runtimeMode: BackgroundJobRuntimeMode },
    ) => Promise<TEnqueueResult>;
    logger?: BackgroundJobQueueLogger;
  },
): Promise<EnqueueAndPublishBackgroundJobResult<TEnqueueResult>> {
  const mode = family.resolveRuntimeMode(input.runtimeMode);
  const enqueue = input.enqueue ?? family.enqueueAndTrigger;
  const result = await enqueue({ ...input.enqueueInput, runtimeMode: mode });

  if (mode === "inline") {
    return { ...result, deliveryId: null, publishResult: null };
  }

  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveryStore.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: family.jobKind,
    jobId: result.job.id,
  });
  const publishResult = await publishBackgroundJobDelivery({
    store: deliveryStore,
    queue: input.queue,
    ownerUserId: input.ownerUserId,
    deliveryId: delivery.id,
    logger: input.logger,
  });

  return { ...result, deliveryId: delivery.id, publishResult };
}
