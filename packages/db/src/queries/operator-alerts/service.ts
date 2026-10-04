import {
  actionableOperatorAlertReadings,
  type OperatorAlertReading,
} from "@tendnote/domain/operator-alerts";
import type { SpendBreakerStage } from "@tendnote/domain/usage-bounds";
import type { ClaimedOperatorAlertNotice, OperatorAlertStore } from "./types";

export type OperatorAlertPassResult = { sent: number; failed: number };

/**
 * One pass of the operator alert channel (#648). It opens an episode for each
 * condition read as firing and clears the episode of each read as clear, then
 * sends every notice that is due. A condition the pass could not read is simply
 * absent from `readings`, so a failed read never sends a false recovery. A
 * failed send is handed back and retried by the next pass, never thrown, so one
 * unreachable destination cannot stop the others' notices.
 */
export async function runOperatorAlertPass(input: {
  store: OperatorAlertStore;
  readings: readonly OperatorAlertReading[];
  /** The Spend Breaker's stage, or `null` when it could not be read. */
  breaker: SpendBreakerStage | null;
  notify: (notice: ClaimedOperatorAlertNotice) => Promise<void>;
  now?: Date;
  logger?: { error?: (message: string, context?: Record<string, unknown>) => void };
}): Promise<OperatorAlertPassResult> {
  const at = input.now ?? new Date();
  for (const reading of actionableOperatorAlertReadings(input.readings, input.breaker)) {
    if (reading.firing) await input.store.open({ condition: reading.condition, at });
    else await input.store.clear({ condition: reading.condition, at });
  }

  const result: OperatorAlertPassResult = { sent: 0, failed: 0 };
  for (const notice of await input.store.claimNotices({ at })) {
    try {
      await input.notify(notice);
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      input.logger?.error?.("operator_alert.send_failed", {
        condition: notice.condition,
        kind: notice.kind,
        reason: error instanceof Error ? error.name : "unknown",
      });
      await input.store.releaseNotice(notice);
    }
  }
  return result;
}
