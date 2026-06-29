import type {
  CreateProviderConnectionInput,
  ProviderConnection,
  ProviderConnectionStatus,
} from "@tendnote/domain";

export type ProviderConnectionAuditLogEntry = {
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
};

/** Identifies one owner-scoped connection row (owner + provider capability). */
export type ProviderConnectionRef = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
};

// The domain create schema already carries `ownerUserId`, so the mutation input is
// the validated create input directly (mirrors `CreatePersonMutationInput`).
export type CreateProviderConnectionMutationInput = CreateProviderConnectionInput;

export type SetProviderConnectionStatusInput = ProviderConnectionRef & {
  status: ProviderConnectionStatus;
};

export type RecordProviderConnectionErrorInput = ProviderConnectionRef & {
  message: string;
};

export type MarkProviderConnectionRevokedInput = ProviderConnectionRef & {
  reason?: string | null;
};

/**
 * Mirror a real provider authorization into owner-scoped product state (Phase 2C,
 * ADR-0071). OAuth token custody lives in Better Auth account records; this only
 * records the non-secret connected status, display identity, and authorized
 * scopes. `displayIdentity`/`authorizedScopes` left `undefined` preserve any
 * existing value; pass `null` to clear.
 */
export type ConnectProviderConnectionInput = ProviderConnectionRef & {
  displayIdentity?: string | null;
  authorizedScopes?: string[] | null;
};

/**
 * Full row the store persists; every field is non-secret (ADR-0069). Columns are
 * listed explicitly rather than `Omit<ProviderConnection, …>` because the domain
 * fields are optional/nullable, but the store must receive every column with a
 * concrete value at insert time.
 */
export type PersistProviderConnectionInput = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
  status: ProviderConnectionStatus;
  displayIdentity: string | null;
  authorizedScopes: string[] | null;
  connectedAt: Date | null;
  revokedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  revocationReason: string | null;
};

/** Defined-only mutable columns handed to the store (undefined keys are dropped). */
export type ProviderConnectionPatch = Partial<
  Pick<
    PersistProviderConnectionInput,
    | "status"
    | "displayIdentity"
    | "authorizedScopes"
    | "connectedAt"
    | "revokedAt"
    | "lastErrorAt"
    | "lastErrorMessage"
    | "revocationReason"
  >
>;

export type ProviderConnectionStore = {
  listProviderConnections: (input: { ownerUserId: string }) => Promise<ProviderConnection[]>;
  getProviderConnection: (ref: ProviderConnectionRef) => Promise<ProviderConnection | null>;
  createProviderConnection: (values: PersistProviderConnectionInput) => Promise<ProviderConnection>;
  updateProviderConnection: (input: {
    ref: ProviderConnectionRef;
    patch: ProviderConnectionPatch;
  }) => Promise<ProviderConnection | null>;
  createAuditLogEntry: (entry: ProviderConnectionAuditLogEntry) => Promise<void>;
};
