import { RETENTION } from "./retention";

/** The Account Ceiling buckets a model call is charged to (ADR 0246). */
export const COST_CATEGORIES = ["interactive", "background", "web_search"] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

/**
 * The account a model-backed adapter's call is metered to. It travels beside
 * an adapter's input, never inside it, so the input stays exactly what the
 * model is allowed to see.
 */
export type MeteredCall = { accountId: string };

/** The Usage Ledger's day for a call: its UTC calendar day, as `YYYY-MM-DD`. */
export function usageLedgerDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The first day the Usage Ledger still keeps: thirteen months before today,
 * clamped to the end of a shorter month. Days before it are swept.
 */
export function usageLedgerCutoffDay(now: Date): string {
  const months = RETENTION.usageLedger.months;
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return usageLedgerDay(target);
}
