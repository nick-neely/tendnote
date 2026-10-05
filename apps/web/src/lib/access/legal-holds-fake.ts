import type { LegalHold } from "@tendnote/db/queries/legal-holds";
import type { LegalHoldDependencies } from "./legal-hold";

/**
 * The Legal Hold records, read the way the Drizzle store reads them: a retried
 * hold names the same account and expiry, so it finds its own record.
 */
export function createLegalHoldsFake() {
  const holds: LegalHold[] = [];
  const legalHolds: LegalHoldDependencies["legalHolds"] = {
    recordLegalHold: async (input) => {
      const existing = holds.find(
        (each) =>
          each.userId === input.userId && each.expiresAt.getTime() === input.expiresAt.getTime(),
      );
      if (existing) return existing;
      const hold = { id: `hold_${holds.length + 1}`, ...input };
      holds.push(hold);
      return hold;
    },
  };
  return { legalHolds, holds };
}
