import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { backgroundJobDeliveries } from "../../schema";
import { topicForBackgroundJob } from "./topics";
import type {
  BackgroundJobDeliveryStore,
  CreateBackgroundJobDeliveryInput,
  UpdateBackgroundJobDeliveryInput,
} from "./types";

function scrubError(error: string) {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}

function valuesFor(input: CreateBackgroundJobDeliveryInput) {
  return {
    ownerUserId: input.ownerUserId,
    jobKind: input.jobKind,
    jobId: input.jobId,
    topic: topicForBackgroundJob(input.jobKind),
    status: "pending" as const,
    attempts: 0,
    lastError: null,
    nextAttemptAt: input.nextAttemptAt ?? new Date(),
  };
}

function updateValues(input: UpdateBackgroundJobDeliveryInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) updates.status = input.status;
  if (input.lastError !== undefined) updates.lastError = input.lastError;
  if (input.nextAttemptAt !== undefined) updates.nextAttemptAt = input.nextAttemptAt;
  if ("publishedAt" in input) updates.publishedAt = input.publishedAt;

  return updates;
}

export function createDrizzleBackgroundJobDeliveryStore(): BackgroundJobDeliveryStore {
  return {
    async createBackgroundJobDelivery(input) {
      const values = valuesFor(input);
      const [delivery] = await getDb()
        .insert(backgroundJobDeliveries)
        .values(values)
        .onConflictDoNothing({
          target: [
            backgroundJobDeliveries.jobKind,
            backgroundJobDeliveries.jobId,
            backgroundJobDeliveries.topic,
          ],
        })
        .returning();

      if (delivery) {
        return { delivery, created: true };
      }

      const existing = await this.findBackgroundJobDeliveryForJob({
        ownerUserId: values.ownerUserId,
        jobKind: values.jobKind,
        jobId: values.jobId,
      });

      if (!existing) {
        throw new Error("Failed to create background job delivery.");
      }

      return { delivery: existing, created: false };
    },
    async getBackgroundJobDelivery(input) {
      const [delivery] = await getDb()
        .select()
        .from(backgroundJobDeliveries)
        .where(
          and(
            eq(backgroundJobDeliveries.id, input.deliveryId),
            eq(backgroundJobDeliveries.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      return delivery ?? null;
    },
    async getBackgroundJobDeliveryForConsumer(deliveryId) {
      const [delivery] = await getDb()
        .select()
        .from(backgroundJobDeliveries)
        .where(eq(backgroundJobDeliveries.id, deliveryId))
        .limit(1);

      return delivery ?? null;
    },
    async findBackgroundJobDeliveryForJob(input) {
      const topic = topicForBackgroundJob(input.jobKind);
      const [delivery] = await getDb()
        .select()
        .from(backgroundJobDeliveries)
        .where(
          and(
            eq(backgroundJobDeliveries.ownerUserId, input.ownerUserId),
            eq(backgroundJobDeliveries.jobKind, input.jobKind),
            eq(backgroundJobDeliveries.jobId, input.jobId),
            eq(backgroundJobDeliveries.topic, topic),
          ),
        )
        .limit(1);

      return delivery ?? null;
    },
    async markBackgroundJobDeliveryPublished(input) {
      const publishedAt = input.publishedAt ?? new Date();
      const [delivery] = await getDb()
        .update(backgroundJobDeliveries)
        .set({
          status: "published",
          lastError: null,
          publishedAt,
          updatedAt: publishedAt,
        })
        .where(
          and(
            eq(backgroundJobDeliveries.id, input.deliveryId),
            eq(backgroundJobDeliveries.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!delivery) {
        throw new Error("Background job delivery not found.");
      }

      return delivery;
    },
    async markBackgroundJobDeliveryPublishFailed(input) {
      const [delivery] = await getDb()
        .update(backgroundJobDeliveries)
        .set({
          status: "publish_failed",
          attempts: sql`${backgroundJobDeliveries.attempts} + 1`,
          lastError: scrubError(input.error),
          nextAttemptAt: input.nextAttemptAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(backgroundJobDeliveries.id, input.deliveryId),
            eq(backgroundJobDeliveries.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!delivery) {
        throw new Error("Background job delivery not found.");
      }

      return delivery;
    },
    async updateBackgroundJobDelivery(input) {
      const [delivery] = await getDb()
        .update(backgroundJobDeliveries)
        .set(updateValues(input))
        .where(
          and(
            eq(backgroundJobDeliveries.id, input.deliveryId),
            eq(backgroundJobDeliveries.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!delivery) {
        throw new Error("Background job delivery not found.");
      }

      return delivery;
    },
    async listBackgroundJobDeliveries(input) {
      const filters = [];

      filters.push(eq(backgroundJobDeliveries.ownerUserId, input.ownerUserId));
      if (input.status) {
        filters.push(eq(backgroundJobDeliveries.status, input.status));
      }

      return getDb()
        .select()
        .from(backgroundJobDeliveries)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(backgroundJobDeliveries.createdAt));
    },
  };
}
