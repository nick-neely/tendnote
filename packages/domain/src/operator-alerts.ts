import { RETENTION } from "./retention";
import { type SpendBreakerStage, sheds } from "./usage-bounds";

type ShedStage = Exclude<SpendBreakerStage, "closed">;

/**
 * The Reliability Indicators' targets (#649, cost and reliability evidence): a
 * reminder delivered within five minutes of its alert time, and no background
 * job left waiting more than thirty minutes past when it was due.
 */
export const REMINDER_LATENESS_LIMIT_MS = 5 * 60 * 1000;
export const BACKGROUND_BACKLOG_LIMIT_MS = 30 * 60 * 1000;

type OperatorAlertConditionDefinition = {
  /** The alert's title, sent when the condition starts firing. */
  alert: string;
  /** The recovery notice's title, sent once when it clears. */
  recovery: string;
  /** Where to look. Fixed text: an alert never names an account or a record. */
  detail: string;
  /**
   * The Spend Breaker stage whose deliberate shedding makes this condition
   * expected rather than alarming, so it does not raise while that stage sheds.
   */
  quietWhileShedding?: ShedStage;
};

/**
 * The conditions the operator alert channel watches (#648). Each is one
 * deployment-wide state that is either firing or clear: the channel alerts once
 * when it starts firing and sends one recovery notice when it clears, however
 * many passes or failures it spans. The text is fixed per condition, so an
 * alert carries no customer data to the mailbox or the phone.
 */
export const OPERATOR_ALERT_CONDITIONS = {
  spend_breaker: {
    alert: "Spend Breaker tripped",
    recovery: "Spend Breaker closed",
    detail:
      "Today's deployment-wide model spend crossed the Spend Breaker ceiling and work is being shed (ADR 0255). See spend_breaker.shed in the logs and spend_breaker_days.",
  },
  stripe_reconciliation: {
    alert: "Stripe reconciliation failing",
    recovery: "Stripe reconciliation recovered",
    detail:
      "A reconciliation pass failed a stage or found a refund matching no Refund record. See stripe_reconciliation.failed in the logs.",
  },
  account_deletion_stuck: {
    alert: "Account deletion stuck over 24 hours",
    recovery: "Stuck account deletions completed",
    detail:
      "A deletion intent is still incomplete twenty-four hours after it was committed. See account_deletion.intent_stuck in the logs.",
  },
  backup_surface: {
    alert: "Backup surface outlives the Backup Window",
    recovery: "Backup surfaces back inside the Backup Window",
    detail: `The Neon history setting differs from the ${RETENTION.backupWindow.days}-day Backup Window, or a snapshot or branch would outlive it (ADR 0250). Treat it as a Suspected Incident. See backup_surface.finding in the logs, or run the backup-surfaces check.`,
  },
  background_backlog: {
    alert: "Background delivery backlog over thirty minutes",
    recovery: "Background delivery backlog cleared",
    detail:
      "A background job (extraction, embedding, or export) has waited more than thirty minutes past when it was due. Inspect the job tables by status and run_after (docs/background-job-delivery.md).",
    quietWhileShedding: "background",
  },
  reminder_lateness: {
    alert: "Reminders delivering late",
    recovery: "Reminder delivery back on time",
    detail:
      "A reminder was delivered, or is still waiting, more than five minutes after its alert time. Inspect reminder_delivery_jobs by status and intended_at.",
  },
  first_value_path: {
    alert: "First Value path check failing",
    recovery: "First Value path check passing",
    detail:
      "The synthetic First Value check could not load the landing page, read the Checkout prices, sign in its account and be admitted by Eve, or get a reply from the model. See first_value_check.failed in the logs for the step.",
  },
  grounded_eve_answer: {
    alert: "Synthetic Eve answer failing",
    recovery: "Synthetic Eve answer passing",
    detail:
      "The daily synthetic check did not get an Eve answer grounded in its fixture memory. See first_value_check.failed in the logs, and re-run with the first-value-check script.",
    quietWhileShedding: "interactive",
  },
} as const satisfies Record<string, OperatorAlertConditionDefinition>;

export type OperatorAlertCondition = keyof typeof OPERATOR_ALERT_CONDITIONS;

/** What one pass observed about a condition. A condition it could not read is left out. */
export type OperatorAlertReading = { condition: OperatorAlertCondition; firing: boolean };

/**
 * The readings a pass acts on. A firing reading for a condition the Spend
 * Breaker is deliberately causing is dropped, so it raises nothing and an alert
 * already open stays open; its clear reading still sends the recovery notice.
 * With the breaker unknown (`null`), nothing is quieted.
 */
export function actionableOperatorAlertReadings(
  readings: readonly OperatorAlertReading[],
  breaker: SpendBreakerStage | null,
): OperatorAlertReading[] {
  return readings.filter((reading) => {
    const definition: OperatorAlertConditionDefinition =
      OPERATOR_ALERT_CONDITIONS[reading.condition];
    const quietStage = definition.quietWhileShedding;
    return !(reading.firing && breaker && quietStage && sheds(breaker, quietStage));
  });
}

export type OperatorAlertNotice = {
  kind: "alert" | "recovery";
  condition: OperatorAlertCondition;
};

/** The fixed, content-free text of one notice. */
export function operatorAlertMessage(notice: OperatorAlertNotice): {
  title: string;
  body: string;
} {
  const definition = OPERATOR_ALERT_CONDITIONS[notice.condition];
  return notice.kind === "alert"
    ? { title: definition.alert, body: definition.detail }
    : { title: definition.recovery, body: `The "${definition.alert}" alert has cleared.` };
}
