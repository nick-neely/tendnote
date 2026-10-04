const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a Past Due account is told (#610): how long full access continues, read
 * from the same dunning window end that the reconciliation job closes,
 * including a dunning extension naming the failed invoice (#633). The
 * window is seven 24-hour days from the failure, not seven calendar dates, so
 * the notice counts only whole days left and names no date: a date would read
 * as "through the end of that day" while the window closes partway into it.
 * Under a day, including the minutes between the window closing and the job's
 * next pass ending the subscription, access ends within a day.
 */
export function pastDueNotice(pastDueUntil: Date, now: Date): { headline: string; detail: string } {
  const daysLeft = Math.floor((pastDueUntil.getTime() - now.getTime()) / DAY_MS);
  const continues =
    daysLeft < 1
      ? "Full access ends within a day."
      : `Full access continues for ${daysLeft} more ${daysLeft === 1 ? "day" : "days"}.`;
  return {
    headline: "Your renewal payment didn't go through.",
    detail: `${continues} Update your card to keep it.`,
  };
}
