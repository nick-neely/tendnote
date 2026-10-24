import type { advanceFirstValueHealth } from "@tendnote/domain/operator-alerts";
import type { OperatorAlertStore } from "./types";

/** Shared by transactional and in-memory adapters; summary closure is silent. */
export async function applyFirstValueDecision(
  decision: ReturnType<typeof advanceFirstValueHealth>,
  at: Date,
  store: OperatorAlertStore,
): Promise<string[]> {
  const opened: string[] = [];
  if (decision.availability === "open") {
    const id = await store.open({
      condition: "first_value_path",
      at: decision.openedAt ?? at,
      firstValueContext: decision.context,
    });
    if (id) opened.push(id);
  } else if (decision.availability === "clear") {
    await store.clear({ condition: "first_value_path", at });
  }
  if (decision.summary) {
    await store.clear({ condition: "first_value_degradation", at });
    const id = await store.open({
      condition: "first_value_degradation",
      at,
      firstValueContext: decision.summary,
    });
    if (id) opened.push(id);
  }
  return opened;
}
