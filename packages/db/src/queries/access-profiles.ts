import { createDrizzleAccessProfileStore } from "./access-profiles/drizzle-store";
import { createAccessProfileQueries } from "./access-profiles/queries";
import type { AccessSource } from "./access-profiles/types";

export { createDrizzleAccessProfileStore } from "./access-profiles/drizzle-store";
export { createInMemoryAccessProfileStore } from "./access-profiles/in-memory-store";
export { createAccessProfileQueries } from "./access-profiles/queries";
export type * from "./access-profiles/types";

const defaultAccessProfileQueries = createAccessProfileQueries(createDrizzleAccessProfileStore());

export async function ensureAccessProfile(input: { userId: string }) {
  return defaultAccessProfileQueries.ensureAccessProfile(input);
}

export async function getAccessProfile(input: { userId: string }) {
  return defaultAccessProfileQueries.getAccessProfile(input);
}

export async function checkAccess(input: { userId: string }) {
  return defaultAccessProfileQueries.checkAccess(input);
}

export async function grantAccess(input: { userId: string; source: AccessSource }) {
  return defaultAccessProfileQueries.grantAccess(input);
}
