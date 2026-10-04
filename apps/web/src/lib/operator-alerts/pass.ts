import { hasStuckAccountDeletionIntent } from "@tendnote/db/queries/account-deletion";
import {
  type ClaimedOperatorAlertNotice,
  createDrizzleOperatorAlertStore,
  runOperatorAlertPass,
} from "@tendnote/db/queries/operator-alerts";
import { readSpendBreakerStage } from "@tendnote/db/queries/spend-breaker";
import { type OperatorAlertReading, operatorAlertMessage } from "@tendnote/domain/operator-alerts";
import type { SpendBreakerStage } from "@tendnote/domain/usage-bounds";
import { type BackupSurfaceCheck, backupSurfaceReading } from "@/lib/backup-surfaces";
import type { StripeReconciliationResult } from "@/lib/billing/stripe-reconciliation";
import {
  createOperatorAlertSender,
  type OperatorAlertMessage,
  operatorAlertDestinations,
} from "./channel";

/**
 * What one cron pass observed about each condition it can read. A read that
 * failed or a stage that did not run gives no reading, so its alert holds
 * rather than recovering. The background backlog's reading comes from the
 * Reliability Indicators (#649).
 */
export function operatorAlertReadings(input: {
  stripeReconciliation: StripeReconciliationResult;
  deletionStuck: boolean | null;
  breaker: SpendBreakerStage | null;
  backupSurfaces: BackupSurfaceCheck | null;
}): OperatorAlertReading[] {
  const readings: OperatorAlertReading[] = [];
  if (input.deletionStuck !== null) {
    readings.push({ condition: "account_deletion_stuck", firing: input.deletionStuck });
  }
  if (input.stripeReconciliation.status === "ran") {
    const { failed, unmatchedRefunds } = input.stripeReconciliation;
    readings.push({ condition: "stripe_reconciliation", firing: failed + unmatchedRefunds > 0 });
  }
  if (input.breaker) {
    readings.push({ condition: "spend_breaker", firing: input.breaker !== "closed" });
  }
  if (input.backupSurfaces?.status === "ran") {
    readings.push({
      condition: "backup_surface",
      firing: input.backupSurfaces.findings.length > 0,
    });
  }
  return readings;
}

function noticeMessage(notice: ClaimedOperatorAlertNotice): OperatorAlertMessage {
  return {
    ...operatorAlertMessage(notice),
    urgent: notice.kind === "alert",
    key: `operator-alert:${notice.episodeId}:${notice.kind}`,
  };
}

/**
 * The alert pass at the end of the recovery cron (#648). Off when no
 * destination is configured. It never throws: an alert pass that fails is
 * logged, and its episodes are picked up again by the next pass.
 */
export async function runOperatorAlerts(input: {
  stripeReconciliation: StripeReconciliationResult;
}) {
  const destinations = operatorAlertDestinations();
  if (!destinations) return { status: "off" as const };

  try {
    const now = new Date();
    const [breaker, deletionStuck, backupSurfaces] = await Promise.all([
      readSpendBreakerStage({ now }).catch(() => null),
      hasStuckAccountDeletionIntent({ now }).catch(() => null),
      backupSurfaceReading({ now }),
    ]);
    const send = createOperatorAlertSender({ destinations });
    const result = await runOperatorAlertPass({
      store: createDrizzleOperatorAlertStore(),
      readings: operatorAlertReadings({ ...input, deletionStuck, breaker, backupSurfaces }),
      breaker,
      notify: (notice) => send(noticeMessage(notice)),
      now,
      logger: console,
    });
    return { status: "ran" as const, ...result };
  } catch (error) {
    console.error("operator_alert.pass_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" as const };
  }
}

/**
 * A new support email arrived (#648). Each message alerts once, keyed by the
 * provider's id for it; the alert never carries the sender, subject, or body.
 * It throws when every destination failed, so the webhook asks for redelivery.
 */
export async function notifyNewSupportEmail(input: { emailId: string }) {
  const destinations = operatorAlertDestinations();
  if (!destinations) return;
  await createOperatorAlertSender({ destinations })({
    title: "New support email",
    body: "A message arrived at the support mailbox. The reply is due by the end of the second business day.",
    urgent: false,
    key: `support-email:${input.emailId}`,
  });
}
