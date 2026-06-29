import {
  createProviderConnectionSchema,
  isProviderConnectionStatusChange,
  providerConnectionStatusSchema,
} from "@tendnote/domain";
import type {
  CreateProviderConnectionMutationInput,
  MarkProviderConnectionRevokedInput,
  ProviderConnectionRef,
  ProviderConnectionStore,
  RecordProviderConnectionErrorInput,
  SetProviderConnectionStatusInput,
} from "./types";

const ENTITY_TYPE = "provider_connection";

/**
 * Shared owner-scoped Provider Connection queries and mutations (ADR-0069, #100).
 * Adapters provide storage; this module owns validation, owner scoping, and audit
 * semantics. Persisted state changes are audited; no-op changes are not. Token
 * custody, OAuth, and provider reads are out of scope for Phase 2B.
 *
 * Owner scoping: reads and mutations are keyed by `ownerUserId` so one owner can
 * never see or change another's connection state. Admitted-access enforcement is
 * the caller's responsibility (hosted product boundaries resolve the admitted
 * owner before calling here).
 */
export function createProviderConnectionQueries(store: ProviderConnectionStore) {
  return {
    /** All of the given owner's connection rows. */
    async listProviderConnections(input: { ownerUserId: string }) {
      return store.listProviderConnections({ ownerUserId: input.ownerUserId });
    },

    async getProviderConnection(ref: ProviderConnectionRef) {
      return store.getProviderConnection(ref);
    },

    async createProviderConnection(input: CreateProviderConnectionMutationInput) {
      const parsed = createProviderConnectionSchema.parse(input);

      const connection = await store.createProviderConnection({
        ownerUserId: parsed.ownerUserId,
        providerKey: parsed.providerKey,
        capabilityKey: parsed.capabilityKey,
        status: parsed.status,
        displayIdentity: parsed.displayIdentity ?? null,
        authorizedScopes: parsed.authorizedScopes ?? null,
        connectedAt: parsed.status === "connected" ? new Date() : null,
        revokedAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        revocationReason: null,
      });

      await writeAudit(store, {
        ownerUserId: connection.ownerUserId,
        action: "provider_connection.create",
        entityId: connection.id,
        metadataJson: {
          providerKey: connection.providerKey,
          capabilityKey: connection.capabilityKey,
          status: connection.status,
        },
      });

      return connection;
    },

    /**
     * Change a connection's status, stamping the lifecycle timestamp that matches
     * the target status. A change to the same status is a no-op: the existing row
     * is returned unchanged and no audit entry is written.
     */
    async setProviderConnectionStatus(input: SetProviderConnectionStatusInput) {
      const status = providerConnectionStatusSchema.parse(input.status);
      const ref = refOf(input);
      const existing = await store.getProviderConnection(ref);

      if (!existing) {
        return null;
      }

      if (!isProviderConnectionStatusChange(existing.status, status)) {
        return existing;
      }

      const now = new Date();
      const updated = await store.updateProviderConnection({
        ref,
        patch: {
          status,
          ...(status === "connected" ? { connectedAt: now } : {}),
          ...(status === "revoked" ? { revokedAt: now } : {}),
          ...(status === "error" ? { lastErrorAt: now } : {}),
        },
      });

      if (!updated) {
        return null;
      }

      await writeAudit(store, {
        ownerUserId: updated.ownerUserId,
        action: "provider_connection.status_change",
        entityId: updated.id,
        metadataJson: {
          providerKey: updated.providerKey,
          capabilityKey: updated.capabilityKey,
          from: existing.status,
          to: updated.status,
        },
      });

      return updated;
    },

    /** Record a provider/authorization error as visible status. */
    async recordProviderConnectionError(input: RecordProviderConnectionErrorInput) {
      const ref = refOf(input);
      const existing = await store.getProviderConnection(ref);

      if (!existing) {
        return null;
      }

      const now = new Date();
      const updated = await store.updateProviderConnection({
        ref,
        patch: { status: "error", lastErrorAt: now, lastErrorMessage: input.message },
      });

      if (!updated) {
        return null;
      }

      await writeAudit(store, {
        ownerUserId: updated.ownerUserId,
        action: "provider_connection.error",
        entityId: updated.id,
        metadataJson: {
          providerKey: updated.providerKey,
          capabilityKey: updated.capabilityKey,
          from: existing.status,
          message: input.message,
        },
      });

      return updated;
    },

    /**
     * Mark a connection revoked. Re-revoking an already-revoked row is a no-op and
     * writes no audit entry.
     */
    async markProviderConnectionRevoked(input: MarkProviderConnectionRevokedInput) {
      const ref = refOf(input);
      const existing = await store.getProviderConnection(ref);

      if (!existing) {
        return null;
      }

      if (existing.status === "revoked") {
        return existing;
      }

      const updated = await store.updateProviderConnection({
        ref,
        patch: {
          status: "revoked",
          revokedAt: new Date(),
          revocationReason: input.reason ?? null,
        },
      });

      if (!updated) {
        return null;
      }

      await writeAudit(store, {
        ownerUserId: updated.ownerUserId,
        action: "provider_connection.revoke",
        entityId: updated.id,
        metadataJson: {
          providerKey: updated.providerKey,
          capabilityKey: updated.capabilityKey,
          from: existing.status,
          reason: input.reason ?? null,
        },
      });

      return updated;
    },
  };
}

function refOf(input: ProviderConnectionRef): ProviderConnectionRef {
  return {
    ownerUserId: input.ownerUserId,
    providerKey: input.providerKey,
    capabilityKey: input.capabilityKey,
  };
}

async function writeAudit(
  store: ProviderConnectionStore,
  entry: {
    ownerUserId: string;
    action: string;
    entityId: string;
    metadataJson: Record<string, unknown>;
  },
) {
  try {
    await store.createAuditLogEntry({ ...entry, entityType: ENTITY_TYPE });
  } catch {
    // The state change is already persisted; an audit-log failure must not lose it.
  }
}
