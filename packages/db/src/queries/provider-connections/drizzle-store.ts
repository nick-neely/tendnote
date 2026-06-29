import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { auditLog, providerConnections } from "../../schema";
import type { ProviderConnectionRef, ProviderConnectionStore } from "./types";

function whereRef(ref: ProviderConnectionRef) {
  return and(
    eq(providerConnections.ownerUserId, ref.ownerUserId),
    eq(providerConnections.providerKey, ref.providerKey),
    eq(providerConnections.capabilityKey, ref.capabilityKey),
  );
}

export function createDrizzleProviderConnectionStore(): ProviderConnectionStore {
  return {
    async listProviderConnections({ ownerUserId }) {
      return getDb()
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.ownerUserId, ownerUserId))
        .orderBy(providerConnections.providerKey, providerConnections.capabilityKey);
    },

    async getProviderConnection(ref) {
      const [connection] = await getDb()
        .select()
        .from(providerConnections)
        .where(whereRef(ref))
        .limit(1);

      return connection ?? null;
    },

    async createProviderConnection(values) {
      const [connection] = await getDb().insert(providerConnections).values(values).returning();

      if (!connection) {
        throw new Error("Failed to create provider connection.");
      }

      return connection;
    },

    async updateProviderConnection({ ref, patch }) {
      const [connection] = await getDb()
        .update(providerConnections)
        .set({ ...patch, updatedAt: new Date() })
        .where(whereRef(ref))
        .returning();

      return connection ?? null;
    },

    async createAuditLogEntry(values) {
      await getDb().insert(auditLog).values(values);
    },
  };
}
