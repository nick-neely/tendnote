import { randomUUID } from "node:crypto";
import { topicForBackgroundJob } from "./topics";
import type {
  BackgroundJobDelivery,
  BackgroundJobDeliveryStore,
  CreateBackgroundJobDeliveryInput,
} from "./types";

function deliveryKey(input: Pick<BackgroundJobDelivery, "jobKind" | "jobId" | "topic">) {
  return `${input.jobKind}:${input.jobId}:${input.topic}`;
}

function scrubError(error: string) {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function createInMemoryBackgroundJobDeliveryStore(): BackgroundJobDeliveryStore {
  const deliveries = new Map<string, BackgroundJobDelivery>();
  const deliveryIdsByKey = new Map<string, string>();

  function createDelivery(input: CreateBackgroundJobDeliveryInput): BackgroundJobDelivery {
    const now = new Date();
    return {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      jobKind: input.jobKind,
      jobId: input.jobId,
      topic: topicForBackgroundJob(input.jobKind),
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: input.nextAttemptAt ?? now,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    async createBackgroundJobDelivery(input) {
      const delivery = createDelivery(input);
      const key = deliveryKey(delivery);
      const existingId = deliveryIdsByKey.get(key);

      if (existingId) {
        const existing = deliveries.get(existingId);
        if (existing) {
          return { delivery: existing, created: false };
        }
      }

      deliveries.set(delivery.id, delivery);
      deliveryIdsByKey.set(key, delivery.id);

      return { delivery, created: true };
    },
    async getBackgroundJobDelivery(input) {
      const delivery = deliveries.get(input.deliveryId);

      return delivery?.ownerUserId === input.ownerUserId ? delivery : null;
    },
    async getBackgroundJobDeliveryForConsumer(deliveryId) {
      return deliveries.get(deliveryId) ?? null;
    },
    async findBackgroundJobDeliveryForJob(input) {
      const topic = topicForBackgroundJob(input.jobKind);
      const deliveryId = deliveryIdsByKey.get(
        deliveryKey({ jobKind: input.jobKind, jobId: input.jobId, topic }),
      );

      const delivery = deliveryId ? deliveries.get(deliveryId) : null;

      return delivery?.ownerUserId === input.ownerUserId ? delivery : null;
    },
    async markBackgroundJobDeliveryPublished(input) {
      const delivery = deliveries.get(input.deliveryId);
      if (!delivery || delivery.ownerUserId !== input.ownerUserId) {
        throw new Error("Background job delivery not found.");
      }
      const now = input.publishedAt ?? new Date();
      const updated: BackgroundJobDelivery = {
        ...delivery,
        status: "published",
        lastError: null,
        publishedAt: now,
        updatedAt: now,
      };
      deliveries.set(updated.id, updated);

      return updated;
    },
    async markBackgroundJobDeliveryPublishFailed(input) {
      const delivery = deliveries.get(input.deliveryId);
      if (!delivery || delivery.ownerUserId !== input.ownerUserId) {
        throw new Error("Background job delivery not found.");
      }
      const updated: BackgroundJobDelivery = {
        ...delivery,
        status: "publish_failed",
        attempts: delivery.attempts + 1,
        lastError: scrubError(input.error),
        nextAttemptAt: input.nextAttemptAt,
        updatedAt: new Date(),
      };
      deliveries.set(updated.id, updated);

      return updated;
    },
    async updateBackgroundJobDelivery(input) {
      const delivery = deliveries.get(input.deliveryId);
      if (!delivery || delivery.ownerUserId !== input.ownerUserId) {
        throw new Error("Background job delivery not found.");
      }
      const updated: BackgroundJobDelivery = {
        ...delivery,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
        ...(input.nextAttemptAt !== undefined ? { nextAttemptAt: input.nextAttemptAt } : {}),
        ...("publishedAt" in input ? { publishedAt: input.publishedAt } : {}),
        updatedAt: new Date(),
      };
      deliveries.set(updated.id, updated);

      return updated;
    },
    async listBackgroundJobDeliveries(input) {
      return [...deliveries.values()]
        .filter((delivery) => {
          if (delivery.ownerUserId !== input.ownerUserId) {
            return false;
          }
          if (input.status && delivery.status !== input.status) {
            return false;
          }
          return true;
        })
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    },
  };
}
