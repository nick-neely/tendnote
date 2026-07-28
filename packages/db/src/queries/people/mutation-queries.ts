import type { MutationOutcome } from "../affected-scopes";
import { affectedScopesForPerson } from "./affected-scopes";
import { createPeopleQueries } from "./queries";
import type { PeopleStore } from "./types";

/** Adds the affected-scope outcome contract to owner-scoped People mutations. */
export function createAffectedPeopleQueries(store: PeopleStore) {
  const queries = createPeopleQueries(store);

  async function withPersonScopes<TResult>(
    resultPromise: Promise<TResult>,
    input: { ownerUserId: string; personId?: string },
  ): Promise<MutationOutcome<TResult>> {
    const result = await resultPromise;
    const personId =
      input.personId ??
      (result && typeof result === "object" && "id" in result
        ? String((result as { id: unknown }).id)
        : null);

    return {
      result,
      affectedScopes:
        result && personId
          ? affectedScopesForPerson({ ownerUserId: input.ownerUserId, personId })
          : [],
    };
  }

  return {
    ...queries,
    createPerson: (input: Parameters<typeof queries.createPerson>[0]) =>
      withPersonScopes(queries.createPerson(input), input),
    updatePerson: (input: Parameters<typeof queries.updatePerson>[0]) =>
      withPersonScopes(queries.updatePerson(input), input),
    deletePerson: (input: Parameters<typeof queries.deletePerson>[0]) =>
      withPersonScopes(queries.deletePerson(input), input),
    deleteCaptureOnlyPerson: (input: Parameters<typeof queries.deleteCaptureOnlyPerson>[0]) =>
      withPersonScopes(queries.deleteCaptureOnlyPerson(input), input),
  };
}
