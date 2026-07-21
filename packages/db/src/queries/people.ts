import { createDrizzlePeopleStore } from "./people/drizzle-store";
import { createPeopleQueries } from "./people/queries";
import type {
  CreatePersonMutationInput,
  DeleteCaptureOnlyPersonInput,
  DeletePersonMutationInput,
  GetPersonInput,
  GetPersonProfileInput,
  SearchPeopleQueryInput,
  UpdatePersonMutationInput,
} from "./people/types";

export { createDrizzlePeopleStore } from "./people/drizzle-store";
export { createInMemoryPeopleStore } from "./people/in-memory-store";
export { createPeopleQueries } from "./people/queries";
export type * from "./people/types";

const defaultPeopleQueries = createPeopleQueries(createDrizzlePeopleStore());

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
