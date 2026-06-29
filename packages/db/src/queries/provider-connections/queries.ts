import {
  createProviderConnectionSchema,
  isProviderConnectionStatusChange,
  providerConnectionStatusSchema,
} from "@tendnote/domain";
import type {
  ConnectProviderConnectionInput,
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
     * Mirror a real provider authorization into owner-scoped product state
     * (Phase 2C, ADR-0071): mark the capability `connected`, record the non-secret
     * display identity and authorized scopes, and clear any prior error/revocation
     * state. Creates the row if it does not exist yet. Idempotent: a re-connect
     * that changes nothing returns the existing row without writing an audit entry.
     * Never stores OAuth tokens — token custody stays in Better Auth.
     */
    async connectProviderConnection(input: ConnectProviderConnectionInput) {
      const ref = refOf(input);
      const existing = await store.getProviderConnection(ref);

      const nextIdentity =
        input.displayIdentity !== undefined
          ? input.displayIdentity
          : (existing?.displayIdentity ?? null);
      const nextScopes =
        input.authorizedScopes !== undefined
          ? input.authorizedScopes
          : (existing?.authorizedScopes ?? null);

      // Validate the non-secret payload (identity length, scope caps) up front.
      const parsed = createProviderConnectionSchema.parse({
        ownerUserId: ref.ownerUserId,
        providerKey: ref.providerKey,
        capabilityKey: ref.capabilityKey,
        status: "connected",
        displayIdentity: nextIdentity,
        authorizedScopes: nextScopes,
      });

      const now = new Date();

      if (!existing) {
        const created = await store.createProviderConnection({
          ownerUserId: parsed.ownerUserId,
          providerKey: parsed.providerKey,
          capabilityKey: parsed.capabilityKey,
          status: "connected",
          displayIdentity: parsed.displayIdentity ?? null,
          authorizedScopes: parsed.authorizedScopes ?? null,
          connectedAt: now,
          revokedAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          revocationReason: null,
        });

        await writeAudit(store, {
          ownerUserId: created.ownerUserId,
          action: "provider_connection.connect",
          entityId: created.id,
          metadataJson: {
            providerKey: created.providerKey,
            capabilityKey: created.capabilityKey,
            from: null,
            created: true,
          },
        });

        return created;
      }

      const identityUnchanged =
        (existing.displayIdentity ?? null) === (parsed.displayIdentity ?? null);
      const scopesUnchanged = scopesEqual(
        existing.authorizedScopes ?? null,
        parsed.authorizedScopes ?? null,
      );

      if (existing.status === "connected" && identityUnchanged && scopesUnchanged) {
        return existing;
      }

      const updated = await store.updateProviderConnection({
        ref,
        patch: {
          status: "connected",
          connectedAt: now,
          displayIdentity: parsed.displayIdentity ?? null,
          authorizedScopes: parsed.authorizedScopes ?? null,
          revokedAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          revocationReason: null,
        },
      });

      if (!updated) {
        return null;
      }

      await writeAudit(store, {
        ownerUserId: updated.ownerUserId,
        action: "provider_connection.connect",
        entityId: updated.id,
        metadataJson: {
          providerKey: updated.providerKey,
          capabilityKey: updated.capabilityKey,
          from: existing.status,
          created: false,
        },
      });

      return updated;
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

/**
 * Set equality for authorized-scope lists (null ≍ no scopes). Order-insensitive
 * because a provider's granted-scope ordering is not guaranteed stable; comparing
 * as sets keeps a re-connect that grants the same scopes idempotent.
 */
function scopesEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((scope) => setB.has(scope));
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
