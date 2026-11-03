import {
  advanceFirstValue,
  claimFirstValueDailyRun,
  emptyFirstValueHealth,
  type FirstValueHealthSample,
  type FirstValueHealthState,
  type FirstValuePolicy,
} from "@tendnote/domain/operator-alerts";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, withDatabaseTransaction } from "../../client";
import { firstValueHealth, operatorAlerts } from "../../schema";
import { applyFirstValueDecision } from "./first-value-decision";
import type { OperatorAlertStore } from "./types";

const ROW_ID = "first_value_path";

/** Locks the singleton row, creating it first, for the rest of the transaction. */
async function lockFirstValueHealth(): Promise<FirstValueHealthState> {
  await getDb()
    .insert(firstValueHealth)
    .values({ id: ROW_ID, state: emptyFirstValueHealth() })
    .onConflictDoNothing();
  const [row] = await getDb()
    .select()
    .from(firstValueHealth)
    .where(eq(firstValueHealth.id, ROW_ID))
    .for("update");
  if (!row) throw new Error("First Value health state unavailable");
  return row.state;
}

async function saveFirstValueHealth(state: FirstValueHealthState) {
  await getDb().update(firstValueHealth).set({ state }).where(eq(firstValueHealth.id, ROW_ID));
}

/**
 * Whether this pass runs the synthetic check. Every pass does under the
 * ten-minute policy; under the daily policy the row lock makes the day's claim
 * atomic, so concurrent passes never both run it.
 */
export async function claimFirstValueRun(
  input: { at: Date },
  policy: FirstValuePolicy,
): Promise<boolean> {
  if (policy === "ten_minute") return true;
  return withDatabaseTransaction(async () => {
    const state = await lockFirstValueHealth();
    const claim = claimFirstValueDailyRun(state, input.at);
    if (claim.state !== state) await saveFirstValueHealth(claim.state);
    return claim.claimed;
  });
}

/** The row lock also fences episode changes, including concurrent cron completions. */
export async function observeFirstValue(
  input: { sample: FirstValueHealthSample; at: Date },
  store: OperatorAlertStore,
  policy: FirstValuePolicy,
): Promise<string[]> {
  return withDatabaseTransaction(async () => {
    const state = await lockFirstValueHealth();
    const [incident] = await getDb()
      .select({ id: operatorAlerts.id })
      .from(operatorAlerts)
      .where(
        and(eq(operatorAlerts.condition, "first_value_path"), isNull(operatorAlerts.clearedAt)),
      )
      .limit(1);
    const decision = advanceFirstValue(policy, {
      state,
      sample: input.sample,
      now: input.at,
      incidentOpen: Boolean(incident),
    });
    if (decision.state === state) return [];
    await saveFirstValueHealth(decision.state);
    return applyFirstValueDecision(decision, input.sample.at, store);
  });
}
