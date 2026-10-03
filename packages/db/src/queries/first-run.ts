import { createDrizzleFirstRunStore } from "./first-run/drizzle-store";
import { createFirstRunQueries } from "./first-run/queries";

export { type HomeFirstRun, NOTHING_OWED } from "./first-run/queries";

const defaultFirstRunQueries = createFirstRunQueries(createDrizzleFirstRunStore());

/** What Home owes the owner: the first-run prompt, the integrations offer, or neither (#639). */
export async function getHomeFirstRun(input: { userId: string }) {
  return defaultFirstRunQueries.getHomeFirstRun(input);
}

/** Whether the owner has saved anyone yet. Owner-scoped. */
export async function hasSavedAPerson(input: { userId: string }) {
  return defaultFirstRunQueries.hasSavedAPerson(input);
}

/** The owner skipped the first-run prompt. */
export async function closeFirstRun(input: { userId: string }) {
  return defaultFirstRunQueries.closeFirstRun(input);
}

/** The owner answered or set aside the integrations offer. */
export async function closeIntegrationOffer(input: { userId: string }) {
  return defaultFirstRunQueries.closeIntegrationOffer(input);
}
