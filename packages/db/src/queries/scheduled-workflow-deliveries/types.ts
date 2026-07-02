import type {
  CreateScheduledWorkflowDeliveryAttemptInput,
  Phase3ScheduledWorkflow,
  ProactiveDeliveryChannel,
  ScheduledWorkflowDeliveryAttempt,
  ScheduledWorkflowDeliverySetting,
  UpsertScheduledWorkflowDeliverySettingInput,
} from "@tendnote/domain";

export type ScheduledWorkflowDeliveryStore = {
  upsertScheduledWorkflowDeliverySetting: (
    input: UpsertScheduledWorkflowDeliverySettingInput,
  ) => Promise<ScheduledWorkflowDeliverySetting>;
  getScheduledWorkflowDeliverySetting: (input: {
    ownerUserId: string;
    workflow: Phase3ScheduledWorkflow;
    channel: ProactiveDeliveryChannel;
  }) => Promise<ScheduledWorkflowDeliverySetting | null>;
  listScheduledWorkflowDeliverySettingsForOwner: (input: {
    ownerUserId: string;
  }) => Promise<ScheduledWorkflowDeliverySetting[]>;
  createScheduledWorkflowDeliveryAttempt: (
    input: CreateScheduledWorkflowDeliveryAttemptInput,
  ) => Promise<ScheduledWorkflowDeliveryAttempt>;
  listScheduledWorkflowDeliveryAttemptsForArtifact: (input: {
    ownerUserId: string;
    artifactId: string;
  }) => Promise<ScheduledWorkflowDeliveryAttempt[]>;
  listScheduledWorkflowDeliveryAttemptsForOwner: (input: {
    ownerUserId: string;
    status?: ScheduledWorkflowDeliveryAttempt["status"];
  }) => Promise<ScheduledWorkflowDeliveryAttempt[]>;
};
