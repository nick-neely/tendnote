import type { BackgroundJobKind } from "./topics";

export type BackgroundJobDeliveryStatus = "pending" | "published" | "publish_failed" | "abandoned";

export type BackgroundJobDelivery = {
  id: string;
  ownerUserId: string;
  jobKind: BackgroundJobKind;
  jobId: string;
  topic: string;
  status: BackgroundJobDeliveryStatus;
  attempts: number;
  lastError?: string | null;
  nextAttemptAt: Date;
  publishedAt?: Date | null;
  /** Bumped by every re-arm of a scheduled delivery; zero for one-shot work. */
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBackgroundJobDeliveryInput = {
  ownerUserId: string;
  jobKind: BackgroundJobKind;
  jobId: string;
  nextAttemptAt?: Date;
};

export type MarkBackgroundJobDeliveryPublishedInput = {
  ownerUserId: string;
  deliveryId: string;
  publishedAt?: Date;
  /**
   * The revision that was sent. When given, a delivery re-armed since then is
   * left untouched, so a slow publish never marks a newer revision published.
   */
  revision?: number;
};

export type MarkBackgroundJobDeliveryPublishFailedInput = {
  ownerUserId: string;
  deliveryId: string;
  error: string;
  nextAttemptAt: Date;
  /** As for {@link MarkBackgroundJobDeliveryPublishedInput.revision}. */
  revision?: number;
};

export type ReviseBackgroundJobDeliveryInput = {
  ownerUserId: string;
  deliveryId: string;
  /** When recovery should next try publishing this revision if nothing else does. */
  nextAttemptAt: Date;
  /**
   * The revision the caller based its decision on. When given, the bump only
   * happens if the delivery is still at it, so a re-arm computed from state
   * read before a concurrent edit cannot supersede that edit.
   */
  revision?: number;
};

export type UpdateBackgroundJobDeliveryInput = {
  deliveryId: string;
  status?: BackgroundJobDeliveryStatus;
  lastError?: string | null;
  nextAttemptAt?: Date;
  publishedAt?: Date | null;
};

export type BackgroundJobDeliveryStore = {
  createBackgroundJobDelivery: (
    input: CreateBackgroundJobDeliveryInput,
  ) => Promise<{ delivery: BackgroundJobDelivery; created: boolean }>;
  getBackgroundJobDelivery: (input: {
    ownerUserId: string;
    deliveryId: string;
  }) => Promise<BackgroundJobDelivery | null>;
  getBackgroundJobDeliveryForConsumer: (
    deliveryId: string,
  ) => Promise<BackgroundJobDelivery | null>;
  findBackgroundJobDeliveryForJob: (input: {
    ownerUserId: string;
    jobKind: BackgroundJobKind;
    jobId: string;
  }) => Promise<BackgroundJobDelivery | null>;
  markBackgroundJobDeliveryPublished: (
    input: MarkBackgroundJobDeliveryPublishedInput,
  ) => Promise<BackgroundJobDelivery>;
  markBackgroundJobDeliveryPublishFailed: (
    input: MarkBackgroundJobDeliveryPublishFailedInput,
  ) => Promise<BackgroundJobDelivery>;
  /**
   * Starts a new revision of a scheduled delivery: pending, unpublished, and
   * with the revision bumped atomically so concurrent re-arms each get their own.
   * Null only when `revision` was given and the delivery has moved past it.
   */
  reviseBackgroundJobDelivery: (
    input: ReviseBackgroundJobDeliveryInput,
  ) => Promise<BackgroundJobDelivery | null>;
  updateBackgroundJobDelivery: (
    input: UpdateBackgroundJobDeliveryInput & { ownerUserId: string },
  ) => Promise<BackgroundJobDelivery>;
  listBackgroundJobDeliveries: (input: {
    ownerUserId: string;
    status?: BackgroundJobDeliveryStatus;
  }) => Promise<BackgroundJobDelivery[]>;
  listDueBackgroundJobDeliveries: (input: {
    statuses: BackgroundJobDeliveryStatus[];
    now: Date;
    limit: number;
  }) => Promise<BackgroundJobDelivery[]>;
};
