import {
  advanceFirstValueHealth,
  emptyFirstValueHealth,
  type FirstValueHealthSample,
} from "@tendnote/domain/operator-alerts";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, withDatabaseTransaction } from "../../client";
import { firstValueHealth, operatorAlerts } from "../../schema";
import { applyFirstValueDecision } from "./first-value-decision";
import type { OperatorAlertStore } from "./types";

/** The row lock also fences episode changes, including concurrent cron completions. */
export async function observeFirstValue(
  input: { sample: FirstValueHealthSample; at: Date },
  store: OperatorAlertStore,
): Promise<string[]> {
  return withDatabaseTransaction(async () => {
    await getDb()
      .insert(firstValueHealth)
      .values({ id: "first_value_path", state: emptyFirstValueHealth() })
      .onConflictDoNothing();
    const [row] = await getDb()
      .select()
      .from(firstValueHealth)
      .where(eq(firstValueHealth.id, "first_value_path"))
      .for("update");
    if (!row) throw new Error("First Value health state unavailable");
    const [incident] = await getDb()
      .select({ id: operatorAlerts.id })
      .from(operatorAlerts)
      .where(
        and(eq(operatorAlerts.condition, "first_value_path"), isNull(operatorAlerts.clearedAt)),
      )
      .limit(1);
    const decision = advanceFirstValueHealth({
      state: row.state,
      sample: input.sample,
      now: input.at,
      incidentOpen: Boolean(incident),
    });
    if (decision.state === row.state) return [];
    await getDb()
      .update(firstValueHealth)
      .set({ state: decision.state })
      .where(eq(firstValueHealth.id, "first_value_path"));
    return applyFirstValueDecision(decision, input.sample.at, store);
  });
}
