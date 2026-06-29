import { randomUUID } from "node:crypto";
import type { ProviderConnection } from "@tendnote/domain";
import type {
  ProviderConnectionAuditLogEntry,
  ProviderConnectionRef,
  ProviderConnectionStore,
} from "./types";

export type InMemoryProviderConnectionStoreSeed = {
  providerConnections?: ProviderConnection[];
};

export type InMemoryProviderConnectionStore = ProviderConnectionStore & {
  listAuditLogEntries: (input: {
    ownerUserId: string;
  }) => Promise<ProviderConnectionAuditLogEntry[]>;
};

function keyOf(ref: ProviderConnectionRef): string {
  return `${ref.ownerUserId}:${ref.providerKey}:${ref.capabilityKey}`;
}

export function createInMemoryProviderConnectionStore(
  seed: InMemoryProviderConnectionStoreSeed = {},
): InMemoryProviderConnectionStore {
  const connections = new Map(
    (seed.providerConnections ?? []).map((connection) => [keyOf(connection), connection]),
  );
  const auditLogEntries: ProviderConnectionAuditLogEntry[] = [];

  return {
    async listProviderConnections({ ownerUserId }) {
      return [...connections.values()]
        .filter((connection) => connection.ownerUserId === ownerUserId)
        .sort((a, b) =>
          `${a.providerKey}:${a.capabilityKey}`.localeCompare(
            `${b.providerKey}:${b.capabilityKey}`,
          ),
        );
    },

    async getProviderConnection(ref) {
      return connections.get(keyOf(ref)) ?? null;
    },

    async createProviderConnection(values) {
      const now = new Date();
      const connection: ProviderConnection = {
        ...values,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      connections.set(keyOf(connection), connection);

      return connection;
    },

    async updateProviderConnection({ ref, patch }) {
      const existing = connections.get(keyOf(ref));

      if (!existing) {
        return null;
      }

      const updated: ProviderConnection = { ...existing, ...patch, updatedAt: new Date() };
      connections.set(keyOf(ref), updated);

      return updated;
    },

    async createAuditLogEntry(values) {
      auditLogEntries.push(values);
    },

    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}
