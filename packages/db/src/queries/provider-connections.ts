import { createDrizzleCalendarCacheStore } from "./calendar/drizzle-store";
import { createDrizzleHouseholdCalendarStore } from "./households/drizzle-calendar-store";
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
// The same revoke also clears whatever a Household Calendar Connection riding
// this member's grant had cached (#387). The household designation itself is
// left standing: revoking a personal connection is recoverable by reconnecting,
// and reads are already closed by the connector-connection gate - but a cache
// must never outlive the access that authorized it (ADR 0219). Leaf store again,
// for the same import-cycle reason as above.
const householdCalendars = createDrizzleHouseholdCalendarStore();
const defaultProviderConnectionQueries = createProviderConnectionQueries(
  createDrizzleProviderConnectionStore(),
  {
    onRevoke: async (ref) => {
      await calendarCache.clearConnection(ref);
      await householdCalendars.clearCachesForConnector({
        connectorUserId: ref.ownerUserId,
        providerKey: ref.providerKey,
        capabilityKey: ref.capabilityKey,
      });
    },
  },
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
