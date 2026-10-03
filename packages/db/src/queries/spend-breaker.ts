import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import {
  SPEND_BREAKER_STAGES,
  type SpendBreakerStage,
  sheds,
  spendBreakerCeilingMicroUsd,
  spendBreakerStage,
} from "@tendnote/domain/usage-bounds";
import { usageLedgerDay } from "@tendnote/domain/usage-ledger";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { accessProfiles, spendBreakerDays, usageLedger } from "../schema";

export type { SpendBreakerStage };

type BreakerDay = typeof spendBreakerDays.$inferSelect;

/** Each stage's column on the day's row. */
const SHED_COLUMN = {
  background: "backgroundShedAt",
  scheduled: "scheduledShedAt",
  interactive: "interactiveShedAt",
} as const;

/**
 * Today's row, opened on the day's first read with the ceiling computed from
 * the accounts admitted then, so the ceiling is recomputed once a day and holds
 * for the rest of it. Concurrent first reads race to insert; the loser keeps
 * the winner's row.
 */
async function openDay(day: string): Promise<BreakerDay> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(spendBreakerDays)
    .where(eq(spendBreakerDays.day, day))
    .limit(1);
  if (existing) return existing;

  const [admitted] = await db
    .select({ accounts: count() })
    .from(accessProfiles)
    .where(eq(accessProfiles.status, "granted"));
  const admittedAccounts = admitted?.accounts ?? 0;
  await db
    .insert(spendBreakerDays)
    .values({
      day,
      admittedAccounts,
      ceilingMicroUsd: spendBreakerCeilingMicroUsd(admittedAccounts),
    })
    .onConflictDoNothing();

  const [opened] = await db
    .select()
    .from(spendBreakerDays)
    .where(eq(spendBreakerDays.day, day))
    .limit(1);
  if (!opened) throw new Error("The Spend Breaker's day could not be opened.");
  return opened;
}

/** What the whole deployment has spent today, in millionths of a dollar. */
async function spentToday(day: string): Promise<number> {
  const [row] = await getDb()
    .select({ microUsd: sql<string>`coalesce(sum(${usageLedger.costMicroUsd}), 0)` })
    .from(usageLedger)
    .where(eq(usageLedger.day, day));
  return Number(row?.microUsd ?? 0);
}

/**
 * Stamps each stage the breaker has newly reached and logs
 * `spend_breaker.shed` once per stage per day, the record the operator alert
 * channel reads. Only the reader whose update stamps the column logs it, so
 * concurrent readers never alert twice. A failure here is logged and never
 * stops the shedding it records.
 */
async function recordShedding(
  breakerDay: BreakerDay,
  stage: SpendBreakerStage,
  spentMicroUsd: number,
  now: Date,
) {
  for (const shedStage of SPEND_BREAKER_STAGES) {
    const column = SHED_COLUMN[shedStage];
    if (!sheds(stage, shedStage) || breakerDay[column] !== null) continue;
    try {
      const stamped = await getDb()
        .update(spendBreakerDays)
        .set({ [column]: now })
        .where(and(eq(spendBreakerDays.day, breakerDay.day), isNull(spendBreakerDays[column])))
        .returning({ day: spendBreakerDays.day });
      if (stamped.length === 0) continue;
      console.error("spend_breaker.shed", {
        day: breakerDay.day,
        stage: shedStage,
        spentMicroUsd,
        ceilingMicroUsd: breakerDay.ceilingMicroUsd,
        admittedAccounts: breakerDay.admittedAccounts,
      });
    } catch (error) {
      console.error("spend_breaker.record_failed", {
        day: breakerDay.day,
        stage: shedStage,
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

/**
 * How far the Spend Breaker sheds right now (ADR 0255): today's deployment-wide
 * spend from the Usage Ledger against today's ceiling. It runs on hosted
 * deployments only; a self-hosted deployment has no plan to derive a ceiling
 * from, so its breaker stays closed. A read that fails throws, and each caller
 * fails in the direction its own usage read already does.
 */
export async function readSpendBreakerStage(
  input: { now?: Date; env?: AdmissionEnvironment } = {},
): Promise<SpendBreakerStage> {
  if (parseAdmissionPolicy(input.env).mode !== "hosted") return "closed";

  const now = input.now ?? new Date();
  const day = usageLedgerDay(now);
  const [breakerDay, spentMicroUsd] = await Promise.all([openDay(day), spentToday(day)]);
  const stage = spendBreakerStage({ ceilingMicroUsd: breakerDay.ceilingMicroUsd, spentMicroUsd });
  if (stage !== "closed") await recordShedding(breakerDay, stage, spentMicroUsd, now);
  return stage;
}
