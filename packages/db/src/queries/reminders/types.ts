import type {
  ReminderDeliveryJob,
  ReminderInstallation,
  ReminderOccurrenceIntent,
  ReminderOptInState,
  ReminderRecordKind,
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
    | "reminder.delivery_failed"
    | "reminder.installation_disabled";
  entityId: string;
  metadata: Record<string, string | number | null>;
  createdAt: Date;
};

export type ReminderRecordRef = {
  ownerUserId: string;
  recordKind: ReminderRecordKind;
  recordId: string;
};

export type ReminderStore = {
  upsertSchedule: (
    input: ReminderRecordRef & {
      choice: ReminderScheduleChoice;
      timeZone: string;
      occurrenceKey: string;
      intendedAt: Date;
      now: Date;
    },
  ) => Promise<ReminderSchedule>;
  listSchedules: (input: ReminderRecordRef) => Promise<ReminderSchedule[]>;
  listSchedulesForOwner: (input: { ownerUserId: string }) => Promise<ReminderSchedule[]>;
  /**
   * Everyone who holds their own schedule for one record, across owners.
   *
   * The one read that crosses subscribers, and the reason it has to exist: a
   * shared record's lifecycle change invalidates *every* member's pending
   * intent, not just the actor's, so completing bin day cannot leave the other
   * partner's phone still holding an alert for an occurrence that is gone
   * (ADR 0203). Nor are the subscribers derivable from the record itself: a
   * household-native Saved Item has no owner to start from, and only the
   * schedule table knows who enrolled. Each subscriber's own schedule is still
   * keyed to them and is still theirs alone to change.
   */
  listScheduleSubscribers: (input: {
    recordKind: ReminderRecordKind;
    recordId: string;
  }) => Promise<ReminderSchedule[]>;
  getSchedule: (input: {
    ownerUserId: string;
    scheduleId: string;
  }) => Promise<ReminderSchedule | null>;
  deleteSchedule: (
    input: ReminderRecordRef & {
      now: Date;
    },
  ) => Promise<void>;
  upsertOccurrenceIntent: (
    input: ReminderRecordRef & {
      scheduleId: string;
      occurrenceKey: string;
      intendedAt: Date;
      freshUntil: Date;
      status: ReminderOccurrenceIntent["status"];
      now: Date;
    },
  ) => Promise<ReminderOccurrenceIntent>;
  listOccurrenceIntents: (input: ReminderRecordRef) => Promise<ReminderOccurrenceIntent[]>;
  listActiveOccurrenceIntentsForOwner: (input: {
    ownerUserId: string;
  }) => Promise<ReminderOccurrenceIntent[]>;
  supersedeOccurrenceIntents: (
    input: ReminderRecordRef & {
      now: Date;
    },
  ) => Promise<void>;
  getOptInState: (input: {
    ownerUserId: string;
    clientInstallationId: string;
  }) => Promise<ReminderOptInState | null>;
  saveOptInState: (input: ReminderOptInState) => Promise<ReminderOptInState>;
  claimStandaloneContinuation: (input: {
    ownerUserId: string;
    clientInstallationId: string;
    now: Date;
  }) => Promise<ReminderOptInState | null>;
  upsertInstallation: (input: {
    ownerUserId: string;
    clientInstallationId: string;
    label: string;
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
  listInstallationsForOwner: (input: { ownerUserId: string }) => Promise<ReminderInstallation[]>;
  setInstallationStatus: (input: {
    ownerUserId: string;
    installationId: string;
    status: ReminderInstallation["status"];
    now: Date;
  }) => Promise<ReminderInstallation>;
  setInstallationPreviewMode: (input: {
    ownerUserId: string;
    clientInstallationId: string;
    previewMode: ReminderInstallation["previewMode"];
    now: Date;
  }) => Promise<ReminderInstallation>;
  suppressInstallationDeliveryJobs: (input: {
    ownerUserId: string;
    installationId: string;
    now: Date;
  }) => Promise<ReminderDeliveryJob[]>;
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

export type ReminderRecord = {
  id: string;
  kind: ReminderRecordKind;
  /**
   * Who owns the record, or null when the Household Workspace does (ADR 0214).
   *
   * Descriptive only, and no longer the same person as the schedule's
   * subscriber. Nothing decides authority from it, because a household-native
   * record has nobody here to decide it from — which is exactly why eligibility
   * is decided by `authorizeSubscription` rather than by comparing this to the
   * caller.
   */
  ownerUserId: string | null;
  /** Whose record it is, so the subscription check can prove the right thing. */
  ownership?: "member_owned" | "household_native";
  householdId?: string | null;
  /**
   * The member this load was resolved *for* - the only identity the schedule
   * paths compare against. Defaults to {@link ReminderRecord.ownerUserId}.
   *
   * A Reminder Schedule belongs to whoever subscribed to it. For most families
   * that is necessarily the record's owner, because their loader is owner-keyed,
   * and those loaders leave this unset. A Saved Item is the exception: any member
   * who can currently see one may choose their own schedule for it, and a
   * household-native one has no owner at all
   * (`docs/phase-8/household-saved-items.md`, ADR 0214). Its loader is keyed by
   * visibility and sets this to the caller it proved the record for.
   *
   * Optional rather than required so the field appears only where the two
   * identities can actually differ, and it is safe to omit: falling back to the
   * owner reproduces the old rule exactly, and for a workspace-owned record the
   * owner is null, so a loader that forgot to set it authorizes nobody.
   */
  subscriberUserId?: string;
  title: string;
  status: string;
  occursAt: Date | null;
  timeSemantics: "date_only" | "instant";
  recurrence: unknown | null;
  sensitivity: "normal" | "sensitive" | "restricted";
  scope: "private" | "shared" | "household";
  personId: string | null;
};

export type ReminderGeneralAction = Omit<
  ReminderRecord,
  "kind" | "occursAt" | "personId" | "timeSemantics"
> & {
  dueAt: Date | null;
};
