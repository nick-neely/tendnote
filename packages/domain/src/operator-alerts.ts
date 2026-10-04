import { RETENTION } from "./retention";
import { type SpendBreakerStage, sheds } from "./usage-bounds";

type ShedStage = Exclude<SpendBreakerStage, "closed">;

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
    alert: "Backup surface does not match the Backup Window",
    recovery: "Backup surfaces match the Backup Window again",
    detail: `The Neon history setting differs from the ${RETENTION.backupWindow.days}-day Backup Window, or a snapshot or branch would outlive it (ADR 0250). Treat it as a Suspected Incident. See backup_surface.finding in the logs, or run the backup-surfaces check.`,
  },
  background_backlog: {
    alert: "Background delivery backlog over thirty minutes",
    recovery: "Background delivery backlog cleared",
    detail: "The oldest pending background delivery is older than thirty minutes.",
    quietWhileShedding: "background",
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
