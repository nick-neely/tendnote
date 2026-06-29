import { createDrizzleProviderConnectionStore } from "./provider-connections/drizzle-store";
import { createProviderConnectionQueries } from "./provider-connections/queries";
import type {
  ConnectProviderConnectionInput,
  CreateProviderConnectionMutationInput,
  MarkProviderConnectionRevokedInput,
  ProviderConnectionRef,
  RecordProviderConnectionErrorInput,
  SetProviderConnectionStatusInput,
} from "./provider-connections/types";

export { createDrizzleProviderConnectionStore } from "./provider-connections/drizzle-store";
export { createInMemoryProviderConnectionStore } from "./provider-connections/in-memory-store";
export { createProviderConnectionQueries } from "./provider-connections/queries";
export type * from "./provider-connections/types";

const defaultProviderConnectionQueries = createProviderConnectionQueries(
  createDrizzleProviderConnectionStore(),
);

export async function listProviderConnections(input: { ownerUserId: string }) {
  return defaultProviderConnectionQueries.listProviderConnections(input);
}

export async function getProviderConnection(ref: ProviderConnectionRef) {
  return defaultProviderConnectionQueries.getProviderConnection(ref);
}

export async function createProviderConnection(input: CreateProviderConnectionMutationInput) {
  return defaultProviderConnectionQueries.createProviderConnection(input);
}

export async function connectProviderConnection(input: ConnectProviderConnectionInput) {
  return defaultProviderConnectionQueries.connectProviderConnection(input);
}

export async function setProviderConnectionStatus(input: SetProviderConnectionStatusInput) {
  return defaultProviderConnectionQueries.setProviderConnectionStatus(input);
}

export async function recordProviderConnectionError(input: RecordProviderConnectionErrorInput) {
  return defaultProviderConnectionQueries.recordProviderConnectionError(input);
}

export async function markProviderConnectionRevoked(input: MarkProviderConnectionRevokedInput) {
  return defaultProviderConnectionQueries.markProviderConnectionRevoked(input);
}
