import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../../client";
import { operatorAlerts } from "../../schema";
import type { OperatorAlertStore } from "./types";

export function createDrizzleOperatorAlertStore(): OperatorAlertStore {
  return {
    async open({ condition, at }) {
      // The partial unique index on open episodes makes this a no-op while one
      // is open, however many passes or readers race to open it.
      await getDb()
        .insert(operatorAlerts)
        .values({ condition, openedAt: at })
        .onConflictDoNothing();
    },

    async clear({ condition, at }) {
      await getDb()
        .update(operatorAlerts)
        .set({ clearedAt: at })
        .where(and(eq(operatorAlerts.condition, condition), isNull(operatorAlerts.clearedAt)));
    },

    async claimNotices({ at }) {
      const columns = { episodeId: operatorAlerts.id, condition: operatorAlerts.condition };
      const recoveries = await getDb()
        .update(operatorAlerts)
        .set({ recoveredAt: at })
        .where(
          and(
            isNotNull(operatorAlerts.clearedAt),
            isNotNull(operatorAlerts.alertedAt),
            isNull(operatorAlerts.recoveredAt),
          ),
        )
        .returning(columns);
      const alerts = await getDb()
        .update(operatorAlerts)
        .set({ alertedAt: at })
        .where(and(isNull(operatorAlerts.clearedAt), isNull(operatorAlerts.alertedAt)))
        .returning(columns);
      return [
        ...recoveries.map((notice) => ({ ...notice, kind: "recovery" as const })),
        ...alerts.map((notice) => ({ ...notice, kind: "alert" as const })),
      ];
    },

    async releaseNotice({ episodeId, kind }) {
      await getDb()
        .update(operatorAlerts)
        .set(kind === "alert" ? { alertedAt: null } : { recoveredAt: null })
        .where(eq(operatorAlerts.id, episodeId));
    },
  };
}
