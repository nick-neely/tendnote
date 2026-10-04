/** How many business days a Temporary Suspension's internal review may run before it is renewed or ended. */
const SUSPENSION_REVIEW_BUSINESS_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The internal review deadline for a suspension placed or renewed at `from`:
 * ten business days later, at the same UTC time of day. Business days are
 * Monday to Friday in UTC; there is no holiday calendar.
 */
export function suspensionReviewDeadline(from: Date): Date {
  let deadline = from.getTime();
  for (let counted = 0; counted < SUSPENSION_REVIEW_BUSINESS_DAYS; ) {
    deadline += DAY_MS;
    if (!isWeekend(new Date(deadline))) counted += 1;
  }
  return new Date(deadline);
}
