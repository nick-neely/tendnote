import {
  DEFAULT_PROVIDER_CAPABILITIES,
  type ProviderConnection,
  type ProviderConnectionStatus,
} from "@tendnote/domain";

/**
 * Account-page read model for Provider Connections (#101, ADR-0069).
 *
 * Overlays the product capability catalog with any persisted owner state so the UI
 * consumes a stable view model rather than raw table rows. A capability with no
 * persisted row defaults to `ready` (offered, connectable later) — Phase 2B never
 * creates rows from the inert affordances, so this is the normal case.
 */
export type ProviderConnectionView = {
  providerKey: string;
  capabilityKey: string;
  label: string;
  status: ProviderConnectionStatus;
  displayIdentity: string | null;
  /** Audit-facing revocation detail; drives the "finish cleanup at Google" note. */
  revocationReason: string | null;
};

export function buildProviderConnectionView(
  connections: ProviderConnection[],
): ProviderConnectionView[] {
  return DEFAULT_PROVIDER_CAPABILITIES.map((capability) => {
    const persisted = connections.find(
      (connection) =>
        connection.providerKey === capability.providerKey &&
        connection.capabilityKey === capability.capabilityKey,
    );

    return {
      providerKey: capability.providerKey,
      capabilityKey: capability.capabilityKey,
      label: capability.label,
      status: persisted?.status ?? "ready",
      displayIdentity: persisted?.displayIdentity ?? null,
      revocationReason: persisted?.revocationReason ?? null,
    };
  });
}
