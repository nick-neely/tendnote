import { createDrizzlePeopleStore } from "./people/drizzle-store";
import { createAffectedPeopleQueries } from "./people/mutation-queries";
import { createPeopleProductQueries } from "./people/product-views";
import type {
  CreatePersonMutationInput,
  DeleteCaptureOnlyPersonInput,
  DeletePersonMutationInput,
  GetPersonInput,
  GetPersonProfileInput,
  SearchPeopleQueryInput,
  UndoPersonUpdateInput,
  UpdatePersonMutationInput,
} from "./people/types";

export { affectedScopesForPeople, affectedScopesForPerson } from "./people/affected-scopes";
export { createDrizzlePeopleStore } from "./people/drizzle-store";
export { createInMemoryPeopleStore } from "./people/in-memory-store";
export { createAffectedPeopleQueries } from "./people/mutation-queries";
export type {
  PeopleListItemView,
  PersonDetailCoreView,
} from "./people/product-views";
export { createPeopleProductQueries } from "./people/product-views";
export { createPeopleQueries } from "./people/queries";
export type * from "./people/types";

const defaultPeopleQueries = createAffectedPeopleQueries(createDrizzlePeopleStore());
const defaultPeopleProductQueries = createPeopleProductQueries(createDrizzlePeopleStore());

export async function createPerson(input: CreatePersonMutationInput) {
  return defaultPeopleQueries.createPerson(input);
}

export async function updatePerson(input: UpdatePersonMutationInput) {
  return defaultPeopleQueries.updatePerson(input);
}

export async function deletePerson(input: DeletePersonMutationInput) {
  return defaultPeopleQueries.deletePerson(input);
}

export async function assertCaptureOnlyPersonRemovable(input: DeleteCaptureOnlyPersonInput) {
  return defaultPeopleQueries.assertCaptureOnlyPersonRemovable(input);
}

export async function deleteCaptureOnlyPerson(input: DeleteCaptureOnlyPersonInput) {
  return defaultPeopleQueries.deleteCaptureOnlyPerson(input);
}

export async function searchPeople(input: SearchPeopleQueryInput) {
  return defaultPeopleQueries.searchPeople(input);
}

export async function getPerson(input: GetPersonInput) {
  return defaultPeopleQueries.getPerson(input);
}

export async function getPersonProfile(input: GetPersonProfileInput) {
  return defaultPeopleQueries.getPersonProfile(input);
}

export async function listPeopleProductView(input: { ownerUserId: string; limit: number }) {
  return defaultPeopleProductQueries.list(input);
}

export async function getPersonDetailCoreView(input: GetPersonProfileInput) {
  return defaultPeopleProductQueries.detail(input);
}

export async function undoPersonUpdate(input: UndoPersonUpdateInput) {
  return defaultPeopleQueries.undoPersonUpdate(input);
}

export async function getLatestPersonUpdate(input: GetPersonInput) {
  return defaultPeopleQueries.getLatestPersonUpdate(input);
}

export async function getPersonUpdateStatus(input: UndoPersonUpdateInput) {
  return defaultPeopleQueries.getPersonUpdateStatus(input);
}
