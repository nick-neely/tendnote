import {
  actionableOperatorAlertReadings,
  type FirstValueHealthSample,
  type OperatorAlertReading,
} from "@tendnote/domain/operator-alerts";
import type { SpendBreakerStage } from "@tendnote/domain/usage-bounds";
import type { ClaimedOperatorAlertNotice, OperatorAlertStore } from "./types";

export type OperatorAlertPassResult = { sent: number; failed: number };

type OperatorAlertPassInput = {
  store: OperatorAlertStore;
  readings: readonly OperatorAlertReading[];
  firstValue?: FirstValueHealthSample;
  /** The Spend Breaker's stage, or `null` when it could not be read. */
  breaker: SpendBreakerStage | null;
  notify: (notice: ClaimedOperatorAlertNotice, observedInThisPass: boolean) => Promise<void>;
  now?: Date;
  logger?: { error?: (message: string, context?: Record<string, unknown>) => void };
};

/**
 * One pass of the operator alert channel (#648). It opens an episode for each
 * condition read as firing and clears the episode of each read as clear, then
 * sends every notice that is due. A condition the pass could not read is simply
 * absent from `readings`, so a failed read never sends a false recovery. A
 * failed send is handed back and retried by the next pass, never thrown, so one
 * unreachable destination cannot stop the others' notices.
 */
export async function runOperatorAlertPass(
  input: OperatorAlertPassInput,
): Promise<OperatorAlertPassResult> {
  const at = input.now ?? new Date();
  const observation = await observeFirstValueSample(input, at);
  const openedHere = new Set(observation.opened);
  const result: OperatorAlertPassResult = { sent: 0, failed: observation.failed };
  for (const reading of actionableOperatorAlertReadings(input.readings, input.breaker)) {
    if (reading.firing) {
      const id = await input.store.open({ condition: reading.condition, at });
      if (id) openedHere.add(id);
    } else await input.store.clear({ condition: reading.condition, at });
  }

  for (const notice of await input.store.claimNotices({ at })) {
    try {
      await input.notify(notice, notice.kind === "alert" && openedHere.has(notice.episodeId));
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

async function observeFirstValueSample(input: OperatorAlertPassInput, at: Date) {
  if (!input.firstValue) return { opened: [] as string[], failed: 0 };
  try {
    const opened = await input.store.observeFirstValue({ sample: input.firstValue, at });
    return { opened, failed: 0 };
  } catch (error) {
    // A failed policy write holds this indicator; other conditions and due
    // deliveries still run. Never fall back to treating the sample as clear.
    input.logger?.error?.("first_value_check.policy_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return { opened: [] as string[], failed: 1 };
  }
}
