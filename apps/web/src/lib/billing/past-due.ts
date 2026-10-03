import { dunningWindowEnd } from "@tendnote/domain";
import { formatBillingDate } from "./billing-date";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a Past Due account is told (#610): how long full access continues, read
 * from the same dunning window end that the reconciliation job closes, so the
 * notice can never promise a day the sweep will not honour. A part day counts
 * as a day left; once the window has closed, before the job's next pass ends
 * the subscription, access ends today.
 */
export function pastDueNotice(pastDueSince: Date, now: Date): { headline: string; detail: string } {
  const closes = dunningWindowEnd(pastDueSince);
  const daysLeft = Math.ceil((closes.getTime() - now.getTime()) / DAY_MS);
  const continues =
    daysLeft <= 0
      ? "Full access ends today."
      : `Full access continues for ${daysLeft} more ${daysLeft === 1 ? "day" : "days"}.`;
  return {
    headline: "Your renewal payment didn't go through.",
    detail: `${continues} Update your card by ${formatBillingDate(closes)} to keep it.`,
  };
}
