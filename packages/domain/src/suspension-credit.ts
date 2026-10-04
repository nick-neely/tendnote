/**
 * A paid invoice's subscription line as the Suspension Credit reads it (#631):
 * the period it paid for, the line amount a credit note credits by, and when
 * its subscription's cancellation takes or took effect, which caps the period;
 * `null` while the subscription renews. The payment provider takes the line's
 * discounts off the credited amount in proportion, so the time-based share of
 * the line is the same share of what the customer actually paid.
 */
export type CreditablePeriod = {
  start: Date;
  end: Date;
  lineAmount: number;
  cancelsAt: Date | null;
};

/**
 * The audited exit of a Temporary Suspension, read from the records: `from` is
 * the suspension's start and `at` is its lift or the Termination that
 * converted it. A Termination also returns the unused remainder, from `at` to
 * the period end.
 */
export type SuspensionExit = { from: Date; at: Date; terminated: boolean };

/** The two parts of one credit note, in the smallest currency unit. */
export type SuspensionCreditAmounts = { suspended: number; remainder: number };

/** `amount * part / whole`, rounded down to the cent, exactly. */
function share(amount: number, partMs: number, wholeMs: number): number {
  return Number((BigInt(amount) * BigInt(partMs)) / BigInt(wholeMs));
}

/**
 * The Suspension Credit for one paid invoice period: the overlap of the denied
 * time with the period, capped at the period end and at any cancellation,
 * divided by the period's length and multiplied by the line amount. The
 * whole credit is rounded down to the cent once, and the suspended part is
 * rounded down within it, so the termination remainder takes whatever is left
 * and the two parts always add up to the rounded whole. All instants are UTC
 * instants from the records; nothing reads the clock.
 *
 * A credit note is issued only when the sum is at least one cent.
 */
export function suspensionCreditAmounts(
  period: CreditablePeriod,
  exit: SuspensionExit,
): SuspensionCreditAmounts {
  const periodMs = period.end.getTime() - period.start.getTime();
  if (periodMs <= 0 || period.lineAmount <= 0) return { suspended: 0, remainder: 0 };

  const coveredUntil = period.cancelsAt ? minDate(period.cancelsAt, period.end) : period.end;
  const deniedFrom = Math.max(period.start.getTime(), exit.from.getTime());
  const creditUntil = (until: Date) =>
    share(period.lineAmount, Math.max(0, until.getTime() - deniedFrom), periodMs);

  const suspendedUntil = minDate(exit.at, coveredUntil);
  const whole = creditUntil(exit.terminated ? coveredUntil : suspendedUntil);
  const suspended = creditUntil(suspendedUntil);
  return { suspended, remainder: whole - suspended };
}

function minDate(a: Date, b: Date): Date {
  return a < b ? a : b;
}
