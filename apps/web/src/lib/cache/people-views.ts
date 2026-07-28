import { getPersonDetailCoreView, listPeopleProductView } from "@tendnote/db/queries/people";
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfiles } from "./cache-profiles";
import { peopleCacheContract } from "./people-contract";

/** Next-specific cache wrappers around framework-neutral, serialized People views. */
export async function getCachedPeopleList(input: { ownerUserId: string; limit: number }) {
  return cachedPeopleList(input.ownerUserId, input.limit);
}

async function cachedPeopleList(ownerUserId: string, limit: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...peopleCacheContract.list({ ownerUserId }).tags);
  return listPeopleProductView({ ownerUserId, limit });
}

export async function getCachedPersonDetailCore(input: { ownerUserId: string; personId: string }) {
  return cachedPersonDetailCore(input.ownerUserId, input.personId);
}

async function cachedPersonDetailCore(callerUserId: string, personId: string) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...peopleCacheContract.detail({ callerUserId, personId }).tags);
  return getPersonDetailCoreView({ ownerUserId: callerUserId, personId });
}
