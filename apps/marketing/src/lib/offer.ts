/**
 * The published offer, held once so Pricing, Fair Use, Support, and Home
 * cannot state it differently.
 *
 * Every figure comes from the Phase 9b decisions: the price and allowances from
 * `docs/phase-9b/paid-offer-and-price.md`, the support promise from
 * `docs/phase-9b/bounded-usage-and-support-contract.md`. Changing one here is a
 * change to a published promise and needs the decision changed first.
 */
export const OFFER = {
  monthlyPrice: 20,
  annualPrice: 200,
  guaranteeDays: 14,
  supportReplyBusinessDays: 2,
} as const;

export const SUPPORT_EMAIL = "support@tendnote.com";

/**
 * Fair use, in dollars per Usage Period. Dollars are what the product
 * enforces; turns are how the page explains it, so the conversion below is
 * published rather than hidden.
 */
export const FAIR_USE = {
  /** Full-quality Eve ends here; Eve continues on a lighter model. */
  eveBudget: 10.5,
  /** Eve pauses here until the Usage Period resets. */
  eveCeiling: 12,
  /** Capture processing, indexing, and scheduled work together. */
  backgroundCeiling: 1.3,
  webSearchCeiling: 0.7,
  webSearches: 100,
  /**
   * What one Eve turn cost in the typical Representative Month at launch
   * prices (`docs/phase-9b/baseline-cost-replay.md`), in dollars.
   */
  typicalTurnCost: 0.042,
} as const;

/**
 * About how many full-quality turns the budget buys. Rounded to the nearest
 * fifty because the per-turn cost is an estimate from one measured month.
 */
export function approximateFullQualityTurns(
  budget: number = FAIR_USE.eveBudget,
  turnCost: number = FAIR_USE.typicalTurnCost,
): number {
  return Math.round(budget / turnCost / 50) * 50;
}

export function formatDollars(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}
