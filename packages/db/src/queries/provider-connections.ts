import { createDrizzleCalendarCacheStore } from "./calendar/drizzle-store";
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

// Revoking a connection clears that capability's cached provider data in one place
// (ADR-0080): the Calendar cache for the calendar capability, a no-op (zero rows)
// for capabilities without one. We use the leaf cache store rather than the calendar
// facade because calendar.ts already imports this module's read-gate — going through
// the facade would form an import cycle.
const calendarCache = createDrizzleCalendarCacheStore();
const defaultProviderConnectionQueries = createProviderConnectionQueries(
  createDrizzleProviderConnectionStore(),
  { onRevoke: (ref) => calendarCache.clearConnection(ref).then(() => undefined) },
);

export async function listProviderConnections(input: { ownerUserId: string }) {
  return defaultProviderConnectionQueries.listProviderConnections(input);
}

export async function getProviderConnection(ref: ProviderConnectionRef) {
  return defaultProviderConnectionQueries.getProviderConnection(ref);
}

export async function isProviderCapabilityConnected(ref: ProviderConnectionRef) {
  return defaultProviderConnectionQueries.isProviderCapabilityConnected(ref);
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
