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
  deliveryId: string;
  publishedAt?: Date;
};

export type MarkBackgroundJobDeliveryPublishFailedInput = {
  deliveryId: string;
  error: string;
  nextAttemptAt: Date;
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
  getBackgroundJobDelivery: (deliveryId: string) => Promise<BackgroundJobDelivery | null>;
  findBackgroundJobDeliveryForJob: (input: {
    jobKind: BackgroundJobKind;
    jobId: string;
  }) => Promise<BackgroundJobDelivery | null>;
  markBackgroundJobDeliveryPublished: (
    input: MarkBackgroundJobDeliveryPublishedInput,
  ) => Promise<BackgroundJobDelivery>;
  markBackgroundJobDeliveryPublishFailed: (
    input: MarkBackgroundJobDeliveryPublishFailedInput,
  ) => Promise<BackgroundJobDelivery>;
  updateBackgroundJobDelivery: (input: UpdateBackgroundJobDeliveryInput) => Promise<BackgroundJobDelivery>;
  listBackgroundJobDeliveries: (input?: {
    ownerUserId?: string;
    status?: BackgroundJobDeliveryStatus;
  }) => Promise<BackgroundJobDelivery[]>;
};
