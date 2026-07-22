import type {
  ReminderDeliveryJob,
  ReminderInstallation,
  ReminderOccurrenceIntent,
  ReminderOptInState,
  ReminderSchedule,
  ReminderScheduleChoice,
} from "@tendnote/domain/reminders";

export type ReminderAuditEntry = {
  id: string;
  ownerUserId: string;
  action:
    | "reminder.installation_registered"
    | "reminder.delivery_intent_created"
    | "reminder.delivery_accepted"
    | "reminder.delivery_suppressed"
    | "reminder.delivery_failed";
  entityId: string;
  metadata: Record<string, string | number | null>;
  createdAt: Date;
};

export type ReminderStore = {
  upsertSchedule: (input: {
    ownerUserId: string;
    generalActionId: string;
    choice: ReminderScheduleChoice;
    timeZone: string;
    occurrenceKey: string;
    intendedAt: Date;
    now: Date;
  }) => Promise<ReminderSchedule>;
  listSchedules: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<ReminderSchedule[]>;
  listSchedulesForOwner: (input: { ownerUserId: string }) => Promise<ReminderSchedule[]>;
  getSchedule: (input: {
    ownerUserId: string;
    scheduleId: string;
  }) => Promise<ReminderSchedule | null>;
  deleteSchedule: (input: {
    ownerUserId: string;
    generalActionId: string;
    now: Date;
  }) => Promise<void>;
  upsertOccurrenceIntent: (input: {
    ownerUserId: string;
    generalActionId: string;
    scheduleId: string;
    occurrenceKey: string;
    intendedAt: Date;
    freshUntil: Date;
    status: ReminderOccurrenceIntent["status"];
    now: Date;
  }) => Promise<ReminderOccurrenceIntent>;
  listOccurrenceIntents: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<ReminderOccurrenceIntent[]>;
  listActiveOccurrenceIntentsForOwner: (input: {
    ownerUserId: string;
  }) => Promise<ReminderOccurrenceIntent[]>;
  supersedeOccurrenceIntents: (input: {
    ownerUserId: string;
    generalActionId: string;
    now: Date;
  }) => Promise<void>;
  getOptInState: (input: {
    ownerUserId: string;
    clientInstallationId: string;
  }) => Promise<ReminderOptInState | null>;
  saveOptInState: (input: ReminderOptInState) => Promise<ReminderOptInState>;
  upsertInstallation: (input: {
    ownerUserId: string;
    clientInstallationId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    expirationTime: number | null;
    now: Date;
  }) => Promise<ReminderInstallation>;
  getInstallation: (input: {
    ownerUserId: string;
    installationId: string;
  }) => Promise<ReminderInstallation | null>;
  listEnabledInstallationsForOwner: (input: {
    ownerUserId: string;
  }) => Promise<ReminderInstallation[]>;
  setInstallationStatus: (input: {
    ownerUserId: string;
    installationId: string;
    status: ReminderInstallation["status"];
    now: Date;
  }) => Promise<ReminderInstallation>;
  upsertDeliveryJob: (input: {
    ownerUserId: string;
    occurrenceIntent: ReminderOccurrenceIntent;
    installationId: string;
    now: Date;
  }) => Promise<{ job: ReminderDeliveryJob; created: boolean; changed: boolean }>;
  listDeliveryJobs: (input: { ownerUserId: string }) => Promise<ReminderDeliveryJob[]>;
  getDeliveryJob: (jobId: string) => Promise<ReminderDeliveryJob | null>;
  claimDeliveryJob: (input: { jobId: string; now: Date }) => Promise<ReminderDeliveryJob | null>;
  updateDeliveryJob: (input: {
    jobId: string;
    now: Date;
    status: ReminderDeliveryJob["status"];
    outcome: ReminderDeliveryJob["outcome"];
    attempts?: number;
    nextAttemptAt?: Date;
    lastErrorCode?: string | null;
    acceptedAt?: Date | null;
  }) => Promise<ReminderDeliveryJob>;
  appendAuditEntry: (input: Omit<ReminderAuditEntry, "id">) => Promise<ReminderAuditEntry>;
  listAuditEntries: (input: { ownerUserId: string }) => Promise<ReminderAuditEntry[]>;
};

export type ReminderGeneralAction = {
  id: string;
  ownerUserId: string;
  title: string;
  status: string;
  dueAt: Date | null;
  recurrence: unknown | null;
  sensitivity: "normal" | "sensitive" | "restricted";
  scope: "private" | "shared" | "household";
};
