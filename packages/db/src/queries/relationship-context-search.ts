import { createDrizzleRelationshipContextSearchStore } from "./relationship-context-search/drizzle-store";
import { createRelationshipContextSearchQueries } from "./relationship-context-search/queries";
import type { SearchRelationshipContextQueryInput } from "./relationship-context-search/types";

export { createDrizzleRelationshipContextSearchStore } from "./relationship-context-search/drizzle-store";
export { createInMemoryRelationshipContextSearchStore } from "./relationship-context-search/in-memory-store";
export { createRelationshipContextSearchQueries } from "./relationship-context-search/queries";
export type * from "./relationship-context-search/types";

const defaultRelationshipContextSearchQueries = createRelationshipContextSearchQueries(
  createDrizzleRelationshipContextSearchStore(),
);

export async function searchRelationshipContext(input: SearchRelationshipContextQueryInput) {
  return defaultRelationshipContextSearchQueries.searchRelationshipContext(input);
}
