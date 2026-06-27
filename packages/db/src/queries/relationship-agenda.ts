import { createDrizzleRelationshipAgendaStore } from "./relationship-agenda/drizzle-store";
import { createRelationshipAgenda } from "./relationship-agenda/query";
import type { RelationshipAgendaInput } from "./relationship-agenda/types";

export { createDrizzleRelationshipAgendaStore } from "./relationship-agenda/drizzle-store";
export { createRelationshipAgenda } from "./relationship-agenda/query";
export type * from "./relationship-agenda/types";

const defaultRelationshipAgenda = createRelationshipAgenda(createDrizzleRelationshipAgendaStore());

export async function getRelationshipAgenda(input: RelationshipAgendaInput) {
  return defaultRelationshipAgenda.getRelationshipAgenda(input);
}
